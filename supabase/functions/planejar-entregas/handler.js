import { calcularMatriz, calcularCaminho, planejarViagens } from '../_shared/planejamento.js';

const ORIGENS = new Set(['https://mineirolanches.store','https://www.mineirolanches.store','https://mineiro-lanches.vercel.app',
  'http://localhost:5173','http://localhost:4180','http://localhost:4185']);
const uuid = v => typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const codigos = new Set(['sem_permissao','dados_invalidos','configuracao_rotas_pendente','origem_nao_confirmada',
  'orcamento_rotas_esgotado','pedido_alterado','plano_expirado','mapas_nao_configurados','rota_indisponivel']);
const falha=(codigo,status=422)=>Object.assign(new Error(codigo),{codigo,status});

export function criarPlanejador({supabaseUrl,serviceKey,geoapifyKey,fetcher=fetch,
  esperar=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const headers={apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'};
  async function rpc(nome,body) {
    const r=await fetcher(supabaseUrl+'/rest/v1/rpc/'+nome,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    const j=await r.json().catch(()=>null);
    if(!r.ok) throw falha(codigos.has(j?.message)?j.message:'servidor_indisponivel',j?.message==='sem_permissao'?403:422);
    return j;
  }
  let ultimaConsulta=0;
  const mapasFetch=async(url,op)=>{
    await esperar(Math.max(0,ultimaConsulta+1000-Date.now()));
    ultimaConsulta=Date.now();
    return fetcher(url,op);
  };
  return async req=>{
    const origem=req.headers.get('Origin');
    const cors={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
      'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
    const responder=(j,status=200)=>new Response(JSON.stringify(j),{status,headers:cors});
    if(origem&&!ORIGENS.has(origem))return responder({codigo:'sem_permissao'},403);
    if(origem)cors['Access-Control-Allow-Origin']=origem;
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(req.method!=='POST')return responder({codigo:'metodo_invalido'},405);
    let execucao;
    try {
      const raw=await req.text();
      if(raw.length>8192)throw falha('dados_invalidos');
      let p;
      try {p=JSON.parse(raw);}catch{throw falha('dados_invalidos');}
      if(!p||!['calcular','verificar','automatico'].includes(p.acao))throw falha('dados_invalidos');
      if(p.pedidos!=null&&(!Array.isArray(p.pedidos)||!p.pedidos.length||p.pedidos.length>6||
        !p.pedidos.every(uuid)||new Set(p.pedidos).size!==p.pedidos.length))throw falha('dados_invalidos');
      if(p.ordemFixa!=null&&typeof p.ordemFixa!=='boolean')throw falha('dados_invalidos');
      let autor=null;
      if(p.tokenJob!=null) {
        if(typeof p.tokenJob!=='string'||p.tokenJob.length>100||!['automatico','verificar'].includes(p.acao)||p.pedidos!=null)
          throw falha('dados_invalidos');
      } else {
        if(p.acao==='automatico')throw falha('sem_permissao',403);
        const token=req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
        if(!token)throw falha('sessao',401);
        const r=await fetcher(supabaseUrl+'/auth/v1/user',{headers:{...headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
        const usuario=await r.json().catch(()=>null);
        if(!r.ok||!uuid(usuario?.id))throw falha('sessao',401);
        autor=usuario.id;
      }
      const ctx=await rpc('iniciar_planejamento_entregas',{p_autor:autor,p_token:p.tokenJob||null,p_pedidos:p.pedidos||null,
        p_ordem_fixa:!!p.ordemFixa,p_verificar:p.acao==='verificar'});
      if(ctx?.estado!=='calcular')return responder(ctx||{estado:'aguarde'});
      execucao=ctx.id;
      const op={geoapifyKey,fetcher:mapasFetch,tentativas:1,signal:AbortSignal.timeout(45000)};
      if(ctx.verificacao) {
        const pontos=[ctx.origem,{lat:ctx.origem.lat+0.001,lon:ctx.origem.lon}];
        await calcularMatriz(pontos,op);
        await calcularCaminho([...pontos,ctx.origem],op);
        const r=await rpc('concluir_planejamento_entregas',{p_execucao:execucao,p_planos:[],p_impedidos:[],p_matriz:null,p_erro:null});
        return responder(r);
      }
      const pontos=[ctx.origem,...ctx.pedidos.map(p=>p.ponto)];
      const matriz=ctx.matriz||await calcularMatriz(pontos,op);
      const r=planejarViagens({pedidos:ctx.pedidos,entregadores:ctx.entregadores,regras:ctx.regras,
        agora:Date.parse(ctx.agora),ordemFixa:ctx.ordemFixa},matriz);
      const destinos=new Map(ctx.pedidos.map(p=>[p.id,p.ponto]));
      for(const v of r.viagens) v.geometria=await calcularCaminho([ctx.origem,...v.paradas.map(p=>destinos.get(p.id)),ctx.origem],op);
      return responder(await rpc('concluir_planejamento_entregas',{p_execucao:execucao,p_planos:r.viagens,
        p_impedidos:r.impedidos,p_matriz:ctx.matriz?null:matriz,p_erro:null}));
    } catch(e) {
      const codigo=codigos.has(e.codigo)||e.codigo==='sessao'?e.codigo:'rota_indisponivel';
      if(execucao)try {await rpc('concluir_planejamento_entregas',{p_execucao:execucao,p_planos:[],p_impedidos:[],p_matriz:null,p_erro:codigo});}catch{
        console.warn('planejamento_entregas: encerramento da execução pendente');
      }
      return responder({codigo},codigo==='sessao'?401:codigo==='sem_permissao'?403:codigo==='orcamento_rotas_esgotado'?429:e.status||503);
    }
  };
}
