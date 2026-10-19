import { test as teste } from 'node:test';
const test = process.env.NODE_TEST_CONTEXT ? teste : () => {};
import assert from 'node:assert/strict';
import { criarFila } from '../src/motoboy/fila.js';
function preparar(enviar) {
  const registros = new Map(); let n=0, agora=1000;
  const armazenamento={listar:async()=>[...registros.values()].map(e=>({...e})),salvar:async e=>registros.set(e.evento,{...e}),remover:async id=>registros.delete(id)};
  const confirmados=[];
  const fila=criarFila({armazenamento,enviar,uuid:()=>`evento-${++n}`,agora:()=>agora,aoConfirmar:r=>confirmados.push(r)});
  return {fila,registros,armazenamento,confirmados,tempo:v=>{agora=v;}};
}
const pedido={id:'pedido-1',atribuicao:'atribuicao-1'};
const ok=e=>({ok:true,pedido:{id:e.id,status:'entregue'}});
test('grava antes do envio e conserva o mesmo evento ao repetir o toque',async()=>{
  const t=preparar(ok),e=await t.fila.adicionar(pedido),repetido=await t.fila.adicionar(pedido);
  assert.deepEqual(e,repetido); assert.equal(t.registros.size,1); assert.equal(e.confirmadoEm,new Date(1000).toISOString());
});
test('falha de rede conserva evento, versão e horário para o reenvio',async()=>{
  let falha=true; const enviados=[];
  const t=preparar(async e=>{enviados.push({...e}); if(falha)throw {codigo:'rede'}; return ok(e);});
  await t.fila.adicionar(pedido); await t.fila.sincronizar(); assert.equal(t.registros.size,1);
  falha=false; await t.fila.sincronizar(); assert.equal(enviados.length,1,'respeita intervalo');
  await t.fila.sincronizar(true); assert.equal(t.registros.size,0);
  assert.equal(enviados[0].evento,enviados[1].evento); assert.equal(enviados[0].confirmadoEm,enviados[1].confirmadoEm);
});
test('sessão expirada e erros de regra ficam visíveis sem tentativa infinita',async()=>{
  for(const codigo of ['sessao','pedido_cancelado','atribuicao_alterada','sem_permissao']){
    let chamadas=0;const t=preparar(async()=>{chamadas++;throw {codigo};});
    await t.fila.adicionar(pedido);await t.fila.sincronizar();t.tempo(100000);await t.fila.sincronizar();
    assert.equal(chamadas,1);assert.equal([...t.registros.values()][0].estado,'atencao');
  }
});
test('resposta vazia, negativa ou de outro pedido não libera a fila',async()=>{
  for(const resposta of [undefined,{}, {ok:false}, {ok:true,pedido:{id:'outro',status:'entregue'}}, {ok:true,pedido:{id:pedido.id,status:'rota'}}]){
    const t=preparar(async()=>resposta);await t.fila.adicionar(pedido);await t.fila.sincronizar();assert.equal(t.registros.size,1);
  }
});
test('reconhecimento de baixa manual anterior libera sem reaplicar a entrega',async()=>{
  const t=preparar(async e=>({...ok(e),jaEntregue:true}));await t.fila.adicionar(pedido);await t.fila.sincronizar();
  assert.equal(t.registros.size,0);assert.equal(t.confirmados[0].jaEntregue,true);
});
test('nova instância retoma fila do armazenamento persistido',async()=>{
  const t=preparar(ok),e=await t.fila.adicionar(pedido);t.fila.parar();
  const enviados=[];const nova=criarFila({armazenamento:t.armazenamento,enviar:async e=>{enviados.push(e);return ok(e);}});
  await nova.sincronizar(true);assert.equal(enviados[0].evento,e.evento);assert.equal(t.registros.size,0);
});
test('erro de armazenamento impede mensagem de confirmação e envio',async()=>{
  const t=preparar(ok);t.armazenamento.salvar=async()=>{throw new Error('quota');};
  await assert.rejects(t.fila.adicionar(pedido),/quota/);assert.equal(t.confirmados.length,0);
});
test('sincronizações concorrentes na mesma tela não enviam duas vezes',async()=>{
  let liberar,chamadas=0;const aguarde=new Promise(r=>{liberar=r;});
  const t=preparar(async e=>{chamadas++;await aguarde;return ok(e);});await t.fila.adicionar(pedido);
  const a=t.fila.sincronizar();await Promise.resolve();const b=t.fila.sincronizar();liberar();await Promise.all([a,b]);
  assert.equal(chamadas,1);assert.equal(t.registros.size,0);
});

test('conferência de cancelamento exige reconhecimento com o mesmo evento',async()=>{
  const t=preparar(async()=>{throw {codigo:'pedido_cancelado'};});const e=await t.fila.adicionar(pedido);await t.fila.sincronizar();
  await assert.rejects(t.fila.reconhecerCancelamento(e.evento,async()=>({ok:true,ocorrencia:true,evento:'outro'})));
  assert.equal(t.registros.size,1);
  await t.fila.reconhecerCancelamento(e.evento,async()=>({ok:true,ocorrencia:true,evento:e.evento}));assert.equal(t.registros.size,0);
});
