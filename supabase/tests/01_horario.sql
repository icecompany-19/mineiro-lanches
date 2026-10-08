-- Dia de operação (corte às 4h de São Paulo) e loja aberta/fechada pelo horário e pelos modos manuais.
-- Datas: 08/10/2026 é quinta; 09 sexta; 10 sábado; 11 domingo; 12 segunda; 13 terça.
-- CONFIG: segunda a quinta 19h–0h; sexta e sábado 19h–1h; domingo null (a confirmar).
begin;
\ir _ajuda.sql

-- dia de operação
select pg_temp.igual(dia_operacional('2026-10-08 23:30-03')::text, '2026-10-08', 'dia de operação: quinta 23:30 é quinta');
select pg_temp.igual(dia_operacional('2026-10-09 03:59:59-03')::text, '2026-10-08', 'dia de operação: sexta 03:59 ainda é quinta');
select pg_temp.igual(dia_operacional('2026-10-09 04:00:00-03')::text, '2026-10-09', 'dia de operação: às 4h vira sexta');
select pg_temp.igual(dia_operacional('2026-10-09 06:59:59+00')::text, '2026-10-08', 'dia de operação no fuso de São Paulo (06:59 UTC = 03:59)');
select pg_temp.igual(dia_operacional('2026-10-09 07:00:00+00')::text, '2026-10-09', 'dia de operação no fuso de São Paulo (07:00 UTC = 04:00)');
select pg_temp.igual(dia_operacional()::text, (((now() at time zone 'America/Sao_Paulo') - interval '4 hours')::date)::text, 'dia_operacional() sem argumento usa now()');
set local timezone = 'Asia/Tokyo';
select pg_temp.igual(dia_operacional('2026-10-09 03:59:59-03')::text, '2026-10-08', 'dia de operação não depende do fuso da sessão');
reset timezone;

-- turno automático
update loja set modo = 'auto';
select pg_temp.ok(loja_aberta('2026-10-10 00:30-03'), 'sexta à noite 00:30 (sábado no calendário): aberta, o turno de sexta vai até 1h');
select pg_temp.ok(not loja_aberta('2026-10-10 01:00-03'), 'sábado 01:00: fechada, acabou o turno de sexta');
select pg_temp.ok(not loja_aberta('2026-10-09 00:30-03'), 'sexta 00:30 do calendário: fechada, o turno de quinta acaba à meia-noite');
select pg_temp.ok(not loja_aberta('2026-10-13 00:30-03'), 'terça 00:30: fechada, o turno de segunda acaba à meia-noite');
select pg_temp.ok(not loja_aberta('2026-10-11 20:00-03'), 'domingo 20:00: fechada, domingo é null (a confirmar)');
select pg_temp.ok(loja_aberta('2026-10-11 00:30-03'), 'domingo 00:30: aberta pela sobra do turno de sábado (19h–1h)');
select pg_temp.ok(not loja_aberta('2026-10-12 00:30-03'), 'segunda 00:30: fechada (domingo não tem turno)');
select pg_temp.ok(not loja_aberta('2026-10-12 18:59-03'), 'segunda 18:59: fechada');
select pg_temp.ok(loja_aberta('2026-10-12 19:00-03'), 'segunda 19:00: aberta');
select pg_temp.ok(loja_aberta('2026-10-12 23:59:59-03'), 'segunda 23:59:59: aberta');
select pg_temp.ok(not loja_aberta('2026-10-13 00:00-03'), 'terça 00:00: fechada');
select pg_temp.ok(loja_aberta('2026-10-09 23:00-03'), 'sexta 23:00: aberta');
select pg_temp.ok(loja_aberta('2026-10-10 03:30+00'), '03:30 UTC de sábado = 00:30 de sábado em SP: aberta (fuso aplicado)');
select pg_temp.ok(not loja_aberta('2026-10-09 15:00-03'), 'sexta 15:00: fechada');

-- turnos de teste: o dia todo (00:00–00:00) e nenhum
update loja set horarios = '{"0":["00:00","00:00"],"1":["00:00","00:00"],"2":["00:00","00:00"],"3":["00:00","00:00"],"4":["00:00","00:00"],"5":["00:00","00:00"],"6":["00:00","00:00"]}';
select pg_temp.ok(loja_aberta('2026-10-11 12:00-03') and loja_aberta('2026-10-12 00:00-03'), 'turno 00:00–00:00 = aberta o dia todo');
update loja set horarios = '{"0":null,"1":null,"2":null,"3":null,"4":null,"5":null,"6":null}';
select pg_temp.ok(not loja_aberta('2026-10-09 23:00-03'), 'sem nenhum turno: fechada');

-- modos manuais
update loja set modo = 'aberta';
select pg_temp.ok(loja_aberta('2026-10-11 20:00-03'), 'modo aberta: aberta fora do horário');
update loja set modo = 'fechada', horarios = '{"5":["19:00","01:00"]}';
select pg_temp.ok(not loja_aberta('2026-10-09 23:00-03'), 'modo fechada: fechada dentro do horário');
delete from loja;
select pg_temp.ok(not loja_aberta(), 'sem linha de loja: fechada');

-- o cliente consegue perguntar
rollback;
begin;
\ir _ajuda.sql
select pg_temp.sou(null);
set local role anon;
select pg_temp.ok(loja_aberta() and dia_operacional() is not null, 'anon chama loja_aberta() e dia_operacional()');
reset role;
rollback;
