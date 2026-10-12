/* S6 · letreiro da noite (dono: site-I). Seção: section.s-noite, entre os marcadores [S6] do index.html.
   Hoje: o cartão .horario com as 7 lâmpadas ([data-semana]) e o status ([data-status]); os dois são escritos por
   src/app.js (atualizarStatus, no carregamento, a cada minuto e no evento loja:modo), como na bio.
   (B8: CONFIG.horarioTexto, relógio de Suzano e a régua "Simule um horário", que só muda esta seção.) */

export function iniciar(ctx) {
  const sec = ctx.$('.s-noite');
  if (!sec) return;
}
