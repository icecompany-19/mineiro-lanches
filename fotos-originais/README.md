# fotos-originais

Pasta de entrada do pipeline de fotos (`scripts/fotos.mjs`). Aqui ficam as fotos **originais** do cliente, do jeito que
saem do WhatsApp. Elas **não vão para o git** (`.gitignore`: `*.jpg`, `*.jpeg`, `*.png` e `*.heic`), porque podem ter
GPS e dados do celular no EXIF. No git ficam só este README e o `mapa.json`.

O pipeline liga cada foto ao produto, gera as variantes que o app usa (`public/assets/fotos/<slug>-q|540|1080.webp`),
atualiza `public/assets/fotos.json` e recorta as texturas de parede (`public/assets/texturas/tijolo-N.webp`). A saída
não leva EXIF nenhum (nem GPS) e a foto não é retocada: só girada pela orientação, recortada e reduzida.

## Quando o zip do cliente chegar

1. **Descompacte aqui**, sem subpastas, e apague o `.zip` depois:

   ```bash
   unzip -j ~/Downloads/fotos-mineiro.zip -d fotos-originais/
   ```

   Os nomes do WhatsApp têm data e hora (`WhatsApp Image 2026-10-09 at 18.58.12.jpeg`, `... (1).jpeg`). Não renomeie:
   é pelo horário que o script acha o produto. HEIC não abre: converta para JPEG antes.

2. **Simule** e leia o relatório (nada é gravado):

   ```bash
   node scripts/fotos.mjs --simular
   ```

3. **Revise o relatório** e ajuste o `mapa.json` (seção abaixo) até ficar certo:

   | Seção | O que fazer |
   |---|---|
   | Ligadas | Confira produto e arquivo de cada linha. Abra a foto se a legenda não bater. |
   | Não usadas | Segunda foto, álbum, antiga com foto nova ou reserva. Para trocar a escolhida, declare o arquivo no `mapa.json`. |
   | Sem produto | Fora da tabela de horários, ambíguo (dois envios no mesmo minuto de distância) ou sem legenda (10/10 18:03, 12/10 00:15, antigas de 08/10). Olhe a foto e declare no `mapa.json`. |
   | Produtos sem foto | Ficam com a arte da categoria. É só informativo. |
   | Produtos ainda com foto antiga | Continuam com a provisória (`origem: 'antiga'`). |
   | Resolução baixa | Largura menor que 1080 px: a `-1080` sai menor e a ficha fica borrada em tela densa. Peça a foto original ao cliente (a do WhatsApp é comprimida). |
   | Campo foto a ajustar no CONFIG | Produto que ganhou foto, mas o `foto:` dele em `src/core.js` aponta para outro nome (ou não existe). Ajuste o CONFIG. |
   | Texturas de parede | Recortes de parede gerados a partir das fotos. |

4. **Rode de verdade**, confira as fotos no app e só então faça o commit (variantes, `fotos.json`, texturas e `mapa.json`):

   ```bash
   node scripts/fotos.mjs
   npm run build && npx playwright test tests/imagens.spec.js
   ```

O script só sobrescreve as variantes dos produtos que ligou. As outras fotos e as chaves `recorte:*` do `fotos.json` ficam
como estão. Pasta sem fotos não grava nada.

## Como o arquivo vira produto

Nesta ordem:

1. `mapa.json`, `arquivos`: nome do arquivo (com ou sem extensão) → id do produto.
2. Nome do arquivo igual ao id de um produto do CONFIG (ex.: `dog-max.jpeg`).
3. Horário do nome do WhatsApp na tabela `ENVIOS` do `scripts/fotos.mjs` (cópia da tabela de `docs/CLIENTE-2026-10.md`),
   com tolerância de ±2 min. O minuto exato ganha; empate entre dois envios diferentes fica sem produto.

Várias fotos para o mesmo produto: vence a principal nova, depois a alternativa nova (ex.: a 2ª foto do combo, às 21:08),
depois a antiga. Entre iguais, a declarada no `mapa.json` e depois a mais cedo. A **reserva** (Combo Casal das 21:15,
fora do cenário) só entra se não houver nenhuma outra foto, nem a provisória que já está no `fotos.json`.

## mapa.json

Chaves que começam com `_` são comentários.

```json
{
 "arquivos": {
  "WhatsApp Image 2026-10-10 at 18.03.41.jpeg": "gran-chicken",
  "WhatsApp Image 2026-10-09 at 20.36.12": { "produto": "porcao-batata", "foco": "50% 60%" },
  "WhatsApp Image 2026-10-08 at 10.45.02.jpeg": { "produto": "dog-pizza", "origem": "antiga" },
  "WhatsApp Image 2026-10-09 at 21.15.07.jpeg": { "produto": "combo-casal", "papel": "principal" },
  "WhatsApp Image 2026-10-09 at 15.20.00.jpeg": null
 },
 "compartilhadas": { "dog-medio": "dog-max", "dog-super": "dog-max" },
 "foco_padrao": "50% 50%",
 "foco": { "gran-bacon": "50% 62%", "dog-max": "auto" },
 "paredes": [
  { "arquivo": "WhatsApp Image 2026-10-09 at 21.03.10.jpeg", "x": 320, "y": 0, "w": 880, "h": 660 },
  { "arquivo": "WhatsApp Image 2026-10-12 at 00.18.30.jpeg", "x": 0, "y": 0, "w": 1200, "h": 600, "nome": "tijolo-2" }
 ]
}
```

- **arquivos**: `"produto"` simples ou objeto com `produto`, `papel` (`principal`, `alternativa` ou `reserva`), `origem`
  (`nova` ou `antiga`) e `foco`. `null` ignora o arquivo. Vale mais que o horário.
- **compartilhadas**: produto que usa a foto de outro. Os três tamanhos de hot dog usam a do Dog Max, então `dog-medio` e
  `dog-super` não aparecem como "sem foto" e o relatório confere se o `foto:` deles no CONFIG é `dog-max`.
- **foco**: ponto focal do recorte quadrado `-q` (cards, sacola, stories), em `x% y%` da foto: o centro do lanche. O
  recorte é o maior quadrado com esse ponto no centro, sem sair da foto. `auto` deixa o sharp achar a região de interesse.
  Rodando de novo sobre a mesma foto, vale o foco que já está no `fotos.json`.
- **paredes**: trecho de parede de tijolinho sem lanche, prato ou planta, em pixels da foto já em pé. Gera
  `public/assets/texturas/<nome ou tijolo-N>.webp` (até 1600 px de largura), sem retoque. Para medir, abra a foto num
  editor e anote o retângulo. A textura real substitui o `tijolo.svg` (desenhado em código), que é só o plano B.

## Opções do script

```
node scripts/fotos.mjs [pasta]          padrão: fotos-originais/
  --simular                             só o relatório, sem gravar
  --mapa <arquivo>                      padrão: <pasta>/mapa.json
  --saida <pasta>                       padrão: public/assets/fotos
  --json <arquivo>                      padrão: public/assets/fotos.json
  --texturas <pasta>                    padrão: public/assets/texturas
  --core <arquivo>                      padrão: src/core.js (CONFIG para conferir os produtos)
node scripts/fotos.mjs --svg-tijolo     refaz public/assets/texturas/tijolo.svg
```

Teste: `node --test tests/fotos.test.mjs` (roda tudo numa pasta temporária; não grava em `public/`).
