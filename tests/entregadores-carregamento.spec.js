/* global document, window */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fonte = (arquivo) =>
  readFileSync(new URL(`../src/painel/${arquivo}`, import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/^export /gm, '');

test('saídas ficam disponíveis enquanto o histórico carrega, inclusive com atribuição manual sem viagem', async ({ page }) => {
  await page.clock.install();
  await page.setContent(
    `<style>[data-desktop]{display:none}@media(min-width:1024px){[data-desktop]{display:block}[data-celular]{display:none}}</style><main id="painel"><div data-desktop><div data-entregadores></div></div><div data-celular><div data-entregadores></div></div></main>`
  );
  await page.evaluate(
    ({ rotas, entregadores }) => {
      window.ML = { fmt: { esc: (v) => String(v ?? ''), numero: (v) => `#${v}`, brl: (v) => `R$ ${v}` } };
      const montarPlanejamento = new Function('calcularRotas', 'mensagemRota', `${rotas};return montarPlanejamento;`)(
        () => {},
        () => 'Falha na consulta'
      );
      const montar = new Function('montarPlanejamento', 'ERROS_ROTAS', `${entregadores};return montarEntregadores;`)(
        montarPlanejamento,
        {}
      );
      const agora = new Date().toISOString();
      let contato = agora;
      const pessoa = {
        id: 'moto',
        nome: 'Motoboy do teste',
        ativo: true,
        declarado: 'na_loja',
        situacao: 'na_loja',
        qtdAbertas: 1,
        elegivel: false
      };
      let concluirHistorico;
      const historico = new Promise((resolve) => {
        concluirHistorico = resolve;
      });
      const ui = montar(document.querySelector('#painel'), {
        consultar: async (nome) =>
          nome === 'painel_rotas_entregas'
            ? {
                servidorEm: agora,
                config: { modo: 'desligado', despachoIndividualAtivo: true, automacaoDisponivel: true, regras: {}, versao: 'config' },
                entregadores: [{ ...pessoa, ultimaEm: contato }],
                prontos: [],
                planos: [],
                viagens: [
                  {
                    id: 'viagem',
                    versao: 'v1',
                    estado: 'em_rota',
                    tipoDespacho: 'individual',
                    motoboyNome: pessoa.nome,
                    metros: null,
                    segundos: null,
                    paradas: [
                      { id: 'planejado', numero: 131, nome: 'Pedido em viagem', endereco: 'Endereço de teste', status: 'rota', ordem: 1 }
                    ]
                  }
                ]
              }
            : historico
      });
      window.concluirHistorico = () =>
        concluirHistorico({
          servidorEm: agora,
          inicio: agora,
          entregadores: [pessoa],
          pedidos: [
            {
              id: 'manual',
              numero: 129,
              nome: 'Pedido manual sem viagem',
              status: 'rota',
              motoboyId: 'moto',
              motoboyNome: pessoa.nome,
              atribuicao: 'atribuicao',
              saiuEm: agora
            },
            {
              id: 'espera',
              numero: 130,
              nome: 'Manual aguardando saída',
              status: 'pronto',
              motoboyId: 'moto',
              motoboyNome: pessoa.nome,
              atribuicao: 'outra-atribuicao'
            },
            {
              id: 'planejado',
              numero: 131,
              nome: 'Pedido em viagem',
              status: 'rota',
              motoboyId: 'moto',
              motoboyNome: pessoa.nome,
              atribuicao: 'atribuicao-viagem',
              saiuEm: agora
            }
          ]
        });
      window.atualizarContato = () => {
        contato = new Date(Date.now() + 1000).toISOString();
      };
      ui.abrir();
    },
    { rotas: fonte('rotas.js'), entregadores: fonte('entregadores.js') }
  );

  await expect(page.locator('[data-r-central]:visible')).toContainText('Saídas da loja');
  await expect(page.locator('.pn-ent-carregando:visible')).toContainText('Carregando entregadores');
  await page.evaluate(() => window.concluirHistorico());
  await expect(page.locator('.pn-ent-carregando:visible')).toHaveCount(0);
  await expect(page.locator('[data-r-central]:visible')).toContainText('Motoboy do teste');
  const resumo = page.locator('[data-e-manuais]:visible');
  await expect(resumo).toContainText('Pedidos atribuídos pela loja');
  await expect(resumo.locator('[data-e-manuais-total]')).toHaveText('2');
  await expect(resumo.locator('[data-e-manual-pedido="manual"]')).toContainText('#129');
  await expect(resumo.locator('[data-e-manual-pedido="manual"]')).toContainText('Em entrega');
  await expect(resumo.locator('[data-e-manual-pedido="espera"]')).toContainText('Aguardando saída');
  await expect(resumo.locator('[data-e-manual-pedido="planejado"]')).toHaveCount(0);
  await expect(page.locator('[data-e-detalhe="manual"]:visible')).not.toHaveAttribute('open');
  await resumo.getByRole('button', { name: 'Ver controle manual' }).click();
  await expect(page.locator('[data-entrega="manual"]:visible')).toContainText('Pedido manual sem viagem');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('[data-desktop] [data-r-central]')).toBeVisible();
  await expect(page.locator('[data-desktop] [data-e-manuais-total]')).toHaveText('2');
  await expect(page.locator('[data-desktop] [data-entrega="manual"]')).toContainText('Pedido manual sem viagem');
  await page.locator('[data-r-detail="rotas"]:visible > summary').click();
  await page.locator('[data-r-detail="config"]:visible > summary').click();
  const campo = page.locator('[data-r-cfg="maxPedidos"]:visible');
  await campo.fill('4');
  await campo.focus();
  await page.evaluate(() => window.atualizarContato());
  await page.clock.fastForward(15_000);
  await expect(campo).toBeFocused();
  await expect(campo).toHaveValue('4');
});
