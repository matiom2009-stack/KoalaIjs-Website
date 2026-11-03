const $ = (id) => document.getElementById(id);
const initialIngredients = [
  {name:"Volle melk", amount:500, sugar:4.8, fat:3.5, vvmb:3.4, other:0.0, pod:1.0, pac:1.0, min:0, max:900, fixed:false},
  {name:"Room 35%", amount:150, sugar:3.0, fat:35, vvmb:2.0, other:0.0, pod:0.6, pac:0.6, min:0, max:500, fixed:false},
  {name:"Magere melkpoeder", amount:80, sugar:52, fat:1, vvmb:35, other:0.0, pod:1.0, pac:0.6, min:0, max:200, fixed:false},
  {name:"Suiker (sacharose)", amount:120, sugar:100, fat:0, vvmb:0, other:0, pod:1.0, pac:1.0, min:0, max:250, fixed:false},
  {name:"Dextrose", amount:70, sugar:100, fat:0, vvmb:0, other:0, pod:0.7, pac:1.9, min:0, max:200, fixed:false},
  {name:"Glucosepoeder", amount:75, sugar:95, fat:0, vvmb:0, other:5, pod:0.5, pac:0.8, min:0, max:200, fixed:false},
  {name:"Bindmiddel", amount:5, sugar:0, fat:0, vvmb:0, other:100, pod:0, pac:0, min:5, max:5, fixed:true}
];
let ingredients = structuredClone(initialIngredients);
let lastCalculated = false;

function renderIngredients(){
  $("ingredientRows").innerHTML = "";
  ingredients.forEach((item,i)=>{
    const tr=document.createElement("tr");
    tr.innerHTML = `
      <td><input aria-label="Naam ingrediënt" data-i="${i}" data-k="name" value="${escapeHtml(item.name)}"></td>
      <td><input aria-label="Hoeveelheid in gram" type="number" min="0" step="0.1" data-i="${i}" data-k="amount" value="${item.amount}" ${item.fixed?"readonly":""}></td>
      <td><button class="delete-row" data-delete="${i}" aria-label="Verwijder ingrediënt" ${item.fixed?"disabled":""}>×</button></td>`;
    $("ingredientRows").appendChild(tr);
  });
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
$("ingredientRows").addEventListener("change",e=>{
  const i=Number(e.target.dataset.i),k=e.target.dataset.k;
  if(!Number.isInteger(i)||!k)return;
  ingredients[i][k]=k==="name"?e.target.value:Math.max(0,Number(e.target.value)||0);
});
$("ingredientRows").addEventListener("click",e=>{
  const b=e.target.closest("[data-delete]");if(!b)return;
  ingredients.splice(Number(b.dataset.delete),1);renderIngredients();lastCalculated=false;
});
$("addIngredient").addEventListener("click",()=>{
  ingredients.push({name:"Nieuw ingrediënt",amount:0,sugar:0,fat:0,vvmb:0,other:0,pod:0,pac:0,min:0,max:500,fixed:false});
  renderIngredients();
});
$("resetRecipe").addEventListener("click",()=>{ingredients=structuredClone(initialIngredients);renderIngredients();$("batchMass").value=1000;lastCalculated=false;$("results").innerHTML='<div class="empty-result">Basisrecept hersteld. Klik op <strong>Bereken recept</strong> om opnieuw te rekenen.</div>';$("resultStatus").textContent="Nog niet berekend";$("resultStatus").className="status-pill";});

const targetIds={sugar:"targetSugar",fat:"targetFat",vvmb:"targetVvmb",other:"targetOther",solids:"targetSolids",water:"targetWater",pod:"targetPod",pac:"targetPac"};
function getTargets(){return Object.fromEntries(Object.entries(targetIds).map(([k,id])=>[k,Number($(id).value)]));}
function composition(list){
  const total=list.reduce((s,x)=>s+x.amount,0)||1;
  const sums={sugar:0,fat:0,vvmb:0,other:0,pod:0,pac:0};
  list.forEach(x=>{for(const k of Object.keys(sums))sums[k]+=x.amount*(Number(x[k])||0)/100;});
  const pct={};for(const k of ["sugar","fat","vvmb","other"])pct[k]=100*sums[k]/total;
  pct.solids=pct.sugar+pct.fat+pct.vvmb+pct.other;
  pct.water=100-pct.solids;
  pct.pod=sums.pod/total*100;pct.pac=sums.pac/total*100;
  return {total,pct,sums};
}
function objective(list,targets){
  const c=composition(list),weights={sugar:2.4,fat:2.5,vvmb:2.0,other:1.5,solids:2.5,water:1.7,pod:0.025,pac:0.025};
  let score=0;
  Object.keys(weights).forEach(k=>{const d=(c.pct[k]-targets[k])*weights[k];score+=d*d;});
  return score;
}
// Coordinate-search heuristic: maintains total batch mass and fixed ingredient quantities.
function optimize(){
  const mass=Number($("batchMass").value),targets=getTargets();
  if(!Number.isFinite(mass)||mass<=0)throw new Error("Vul een geldige receptmassa in.");
  if(ingredients.length<1)throw new Error("Voeg minstens één ingrediënt toe.");
  const fixed=ingredients.filter(x=>x.fixed).reduce((s,x)=>s+x.amount,0);
  const vars=ingredients.filter(x=>!x.fixed);
  if(fixed>mass)throw new Error("De vaste ingrediënten zijn samen zwaarder dan de totale receptmassa.");
  if(!vars.length)throw new Error("Er is geen variabel ingrediënt om te optimaliseren.");
  const working=ingredients.map(x=>({...x}));
  const variableIndexes=working.map((x,i)=>x.fixed?-1:i).filter(i=>i>=0);
  let remaining=mass-fixed;
  let sum=vars.reduce((s,x)=>s+x.amount,0);
  variableIndexes.forEach(i=>working[i].amount=sum?working[i].amount/sum*remaining:remaining/variableIndexes.length);
  const bounds=working.map(x=>({min:Number(x.min)||0,max:Number.isFinite(Number(x.max))?Number(x.max):mass}));
  // Repeated pairwise transfers explore feasible recipes without changing total mass.
  let best=objective(working,targets),step=Math.max(1,mass*.08);
  for(let pass=0;pass<9;pass++){
    let improved=true,guard=0;
    while(improved&&guard++<500){
      improved=false;
      for(let a=0;a<variableIndexes.length;a++)for(let b=a+1;b<variableIndexes.length;b++){
        const ia=variableIndexes[a],ib=variableIndexes[b];
        for(const dir of [-1,1]){
          const delta=step*dir;
          if(working[ia].amount+delta<bounds[ia].min||working[ia].amount+delta>bounds[ia].max||working[ib].amount-delta<bounds[ib].min||working[ib].amount-delta>bounds[ib].max)continue;
          working[ia].amount+=delta;working[ib].amount-=delta;
          const score=objective(working,targets);
          if(score+1e-10<best){best=score;improved=true;}else{working[ia].amount-=delta;working[ib].amount+=delta;}
        }
      }
    }
    step/=2;
  }
  const achieved=working.reduce((s,x)=>s+x.amount,0);
  if(Math.abs(achieved-mass)>.01)throw new Error("De massa kon niet sluitend worden verdeeld. Controleer de grenzen.");
  return {list:working,targets,score:best};
}
function showResults(result){
  const c=composition(result.list),p=c.pct;
  const rows=[["Suiker","sugar","%"],["Vet","fat","%"],["VVMB","vvmb","%"],["Overige DS","other","%"],["Totale droge stof","solids","%"],["Water","water","%"],["POD","pod",""],["PAC","pac",""]];
  $("results").innerHTML=rows.map(([label,key,unit])=>{
    const diff=p[key]-result.targets[key],good=Math.abs(diff)<(unit==="%"?.5:5);
    return `<div class="metric ${good?"good":"warn"}"><span>${label}</span><strong>${p[key].toFixed(1)}${unit}</strong><small>Doel ${result.targets[key].toFixed(1)}${unit} · ${diff>0?"+":""}${diff.toFixed(1)}</small></div>`;
  }).join("");
  const massDiff=c.total-Number($("batchMass").value);
  const overall=rows.every(([,k,u])=>Math.abs(p[k]-result.targets[k])<(u==="%"?.5:5));
  $("resultStatus").textContent=overall?"Doelen benaderd":"Afwijking van doelen";
  $("resultStatus").className="status-pill "+(overall?"good":"warn");
  $("ingredientRows").querySelectorAll("input[data-k='amount']").forEach((el,i)=>{el.value=result.list[i].amount.toFixed(1);});
  ingredients=result.list;
}
$("calculateBtn").addEventListener("click",()=>{
  try{const result=optimize();showResults(result);lastCalculated=true;}
  catch(err){$("resultStatus").textContent="Controleer invoer";$("resultStatus").className="status-pill warn";$("results").innerHTML=`<div class="empty-result">${escapeHtml(err.message)}</div>`;}
});

$("menuToggle").addEventListener("click",()=>{
  const open=$("mainNav").classList.toggle("open");$("menuToggle").setAttribute("aria-expanded",String(open));$("menuToggle").textContent=open?"×":"☰";
});
document.querySelectorAll(".main-nav a").forEach(a=>a.addEventListener("click",()=>{$("mainNav").classList.remove("open");$("menuToggle").setAttribute("aria-expanded","false");$("menuToggle").textContent="☰";}));
$("year").textContent=new Date().getFullYear();
renderIngredients();
