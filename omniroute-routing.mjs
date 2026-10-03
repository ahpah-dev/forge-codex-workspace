import { createChatProviderRouter, GROQ_CODING_MODELS, isGroqProvider, isNvidiaProvider, KILO_FREE_BASE_URL, KILO_FREE_MODEL } from './responses-bridge.mjs';
import { createFreeRouter, FREE_KEY_IDS } from './free-router.mjs';

export function omniRouteFallbacks(providers, hasKey, getKey, fetchImpl = fetch) {
  const result = [];
  // Only known free integrations qualify. Arbitrary custom/paid endpoints never
  // become fallback destinations merely because a key was saved for them.
  for (const provider of providers) {
    if (!hasKey(provider.id)) continue;
    if (provider.nativePreset === 'kilo-free' && provider.baseUrl === KILO_FREE_BASE_URL) result.push({provider,model:KILO_FREE_MODEL,getKey:()=>getKey(provider.id),priority:0});
    else if (isGroqProvider(provider)) {
      const ids = new Set(provider.models.map(model=>model.id));
      for (const model of GROQ_CODING_MODELS.filter(id=>ids.has(id)).slice(0,2)) result.push({provider,model,getKey:()=>getKey(provider.id),priority:2});
    } else if (isNvidiaProvider(provider)) {
      for (const model of provider.models.map(model=>model.id).filter(id=>/^openai\/gpt-oss-(?:20|120)b$/.test(id)).slice(0,2)) result.push({provider,model,getKey:()=>getKey(provider.id),priority:3});
    }
  }
  const openrouter = providers.find(provider=>{try{return new URL(provider.baseUrl).hostname==='openrouter.ai' && hasKey(provider.id);}catch{return false;}});
  const openrouterKey = openrouter?.id || (hasKey(FREE_KEY_IDS.openrouter) ? FREE_KEY_IDS.openrouter : null);
  if (openrouterKey) result.push({provider:{id:'omni-openrouter-free',name:'OpenRouter Free',baseUrl:'https://openrouter.ai/api/v1'},model:'free-catalog',priority:1,
    router:()=>createFreeRouter({fetchImpl,getKey:async name=>name==='openrouter' ? getKey(openrouterKey) : ''})});
  if (!result.some(item=>isNvidiaProvider(item.provider)) && hasKey(FREE_KEY_IDS.nvidia)) result.push({provider:{id:FREE_KEY_IDS.nvidia,name:'NVIDIA NIM',baseUrl:'https://integrate.api.nvidia.com/v1'},model:'openai/gpt-oss-20b',getKey:()=>getKey(FREE_KEY_IDS.nvidia),priority:3});
  return result.sort((a,b)=>a.priority-b.priority);
}

const freeAlias = model => /^auto(?:\/[\w-]+)?:free$/.test(model) || model==='auto/best-free';
const rejected = error => [400,401,402,403,404,408,413,422,429,500,502,503,504].includes(Number(error?.status || error?.code))
  || /can only be used from within OpenCode|no (?:available|connected|free).*model|empty stream|provider stream failed|tool.call.validation|tool_use_failed|Failed to parse tool call arguments|connection|fetch failed|rejected your API key|model discovery|quota|unavailable|rate.limit|usage.limit|HTTP (?:401|402|403|429)/i.test(String(error?.message || ''));

export function createOmniRouteRouting({getFallbacks,onRoute=()=>{},fetchImpl=fetch,now=Date.now}) {
  const cooldowns=new Map(), successful=new Map();
  return {
    reset(){cooldowns.clear();successful.clear();},
    forProvider({provider,model,key,ensureGateway=async()=>{}}) {
      const owner=`${provider.id}:${model}`;
      const routers=new Map();
      const markFailed=(identity,error)=>{cooldowns.set(identity,now()+(/can only be used from within OpenCode/i.test(error.message)?30*60*1000:60*1000));if(successful.get(owner)?.identity===identity)successful.delete(owner);};
      return {
        // Every fallback must receive a budget that works on Groq's free plan;
        // complete schemas remain available through internal tool discovery.
        toolLimit:32,toolSchemaBudget:5000,
        async openCompletion(request,signal,options={}) {
          const candidates=[{provider,model,getKey:async()=>key,gateway:true},...(freeAlias(model)?await getFallbacks():[])];
          for(const item of candidates)item.identity=`${owner}:${item.provider.id}:${item.model}`;
          const pinned=options.route?.identity;
          const last=successful.get(owner);
          const preferred=last?.expires>now()?last.identity:null;
          const ordered=pinned?candidates.filter(item=>item.identity===pinned):candidates.sort((a,b)=>Number(b.identity===preferred)-Number(a.identity===preferred));
          const failures=[];let attempts=0;
          for(const candidate of ordered) {
            if(!pinned && (cooldowns.get(candidate.identity)||0)>now())continue;
            if(++attempts>6)break;
            if(signal?.aborted)throw signal.reason;
            try {
              if(candidate.gateway)await ensureGateway();
              let router=routers.get(candidate.identity);
              if(!router){router=candidate.router?candidate.router():createChatProviderRouter({provider:candidate.provider,model:candidate.model,key:await candidate.getKey(),fetchImpl});routers.set(candidate.identity,router);}
              const opened=await router.openCompletion(request,signal,{...options,route:pinned?options.route:undefined});
              return {...opened,route:{...opened.route,identity:candidate.identity,ownerProviderId:provider.id,providerName:candidate.provider.name,fallback:!candidate.gateway}};
            }catch(error){
              if(signal?.aborted)throw signal.reason || error;
              if(!rejected(error) && !candidate.gateway)throw error;
              markFailed(candidate.identity,error);failures.push(`${candidate.provider.name}: unavailable`);
              if(pinned)throw error;
            }
          }
          throw new Error(`OmniRoute could not find an accessible free model. ${failures.join(' · ') || 'Available routes are cooling down.'} Add or update a Kilo, OpenRouter, Groq, or NVIDIA key in Manage providers, or connect an accessible provider in the OmniRoute dashboard. OpenCode-only routes are not usable in Forge.`);
        },
        confirmRoute(route){successful.set(owner,{identity:route.identity,expires:now()+5*60*1000});onRoute(route);},
        rejectRoute(route,error){
          if(!rejected(error))throw error;
          markFailed(route.identity,error);
        },
      };
    },
  };
}
