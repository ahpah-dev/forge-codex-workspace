import {createChatProviderRouter, flagshipRouterModels, modelAvailabilityError} from './responses-bridge.mjs';

const OPEN_CODE_CATALOG='https://opencode.ai/zen/v1/models';
const isOpenCode=id=>id.startsWith('oc/');
const isFree=id=>isOpenCode(id) && /-free$/.test(id);

// Check the public upstream catalog without sending prompts or gateway keys.
// Availability failures are cached separately from authentication/quota errors.
export function createFlagshipRouterRouting({fetchImpl=fetch,now=Date.now,onRoute=()=>{}}={}) {
  let upstreamIds=null,refreshAt=0,pending=null;
  const rejected=new Map(),sticky=new Map();
  const identity=(provider,model)=>`${provider.baseUrl}|${model}`;
  const unavailable=(provider,id)=>isOpenCode(id) && (upstreamIds && !upstreamIds.has(id.slice(3)) || (rejected.get(identity(provider,id)) || 0)>now());
  function boundedSet(map,key,value){map.set(key,value);if(map.size>1000)map.delete(map.keys().next().value);}
  async function refresh({signal,force=false}={}) {
    if(pending)return pending;
    if(!force && now()<refreshAt)return upstreamIds;
    pending=(async()=>{
      try {
        const response=await fetchImpl(OPEN_CODE_CATALOG,{headers:{Accept:'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
        if(!response.ok)throw new Error('Catalog unavailable');
        const data=await response.json();
        const ids=Array.isArray(data.data)?data.data.map(row=>row?.id).filter(id=>typeof id==='string'&&id):[];
        if(!ids.length)throw new Error('Catalog empty');
        upstreamIds=new Set(ids);refreshAt=now()+300000;
      }catch(error){if(signal?.aborted)throw error;refreshAt=now()+30000;}
      return upstreamIds;
    })().finally(()=>{pending=null;});return pending;
  }
  function filterModels(provider,rows=provider.models) {return flagshipRouterModels(rows).filter(row=>!unavailable(provider,row.id));}
  async function discover(provider,rows,{signal}={}) {if(rows.some(row=>isOpenCode(String(row?.id||''))))await refresh({signal,force:true});return filterModels(provider,rows);}
  function forProvider({provider,model,key,scopeId='default'}) {
    const routeKey=`${provider.id}|${provider.baseUrl}|${model}|${scopeId}`;
    const cached=sticky.get(routeKey);
    const tried=new Set(),routers=new Map();
    let selected=cached?.until>now() && provider.models.some(row=>row.id===cached.model)?cached.model:model;
    let activeRouter;
    const freeChoices=()=>filterModels(provider).map(row=>row.id).filter(isFree).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    function nextFree(){const candidate=freeChoices().find(id=>!tried.has(id));if(!candidate)return null;selected=candidate;return selected;}
    function reject(error){
      const message=error.code==='model_unavailable' || modelAvailabilityError(error);
      const freeFallbackAllowed=isFree(model) || isOpenCode(model) && upstreamIds && !upstreamIds.has(model.slice(3));
      if(!isOpenCode(selected)||!freeFallbackAllowed||!message)throw error;
      boundedSet(rejected,identity(provider,selected),now()+600000);sticky.delete(routeKey);tried.add(selected);
      if(!nextFree())throw Object.assign(new Error(`FlagshipRouter has no responding compatible OpenCode free route. ${error.message} Connect another route in its dashboard or select a different provider. No paid model was selected.`),{code:'model_unavailable',status:error.status});
    }
    return {
      toolLimit:32,toolSchemaBudget:5000,preStreamAttempts:3,
      async openCompletion(request,signal,options={}) {
        if(isOpenCode(model))await refresh({signal});
        if(unavailable(provider,selected)){tried.add(selected);if(!nextFree())throw Object.assign(new Error(`FlagshipRouter model ${model} is no longer supported. No compatible OpenCode free route is available; load current models or connect another route in its dashboard.`),{code:'model_unavailable'});}
        for(let attempt=0;attempt<3;attempt++) {
          if(!routers.has(selected))routers.set(selected,createChatProviderRouter({provider,model:selected,key,fetchImpl}));
          activeRouter=routers.get(selected);
          try {
            const result=await activeRouter.openCompletion(request,signal,options);
            return {...result,route:{...result.route,ownerProviderId:provider.id,providerName:provider.name,fallback:selected!==model,label:`FlagshipRouter${selected!==model?' free fallback':''} · ${selected}`}};
          }catch(error){if(signal?.aborted)throw error;reject(error);if(attempt===2)throw error;}
        }
      },
      confirmRoute(route){boundedSet(sticky,routeKey,{model:selected,until:now()+600000});onRoute({...route,scopeId});},
      rejectRoute(_route,error){if(modelAvailabilityError(error)||error.code==='model_unavailable')reject(error);else activeRouter.rejectRoute(_route,error);},
    };
  }
  return {refresh,filterModels,discover,forProvider};
}
