-- Dia de operação (corte às 4h de São Paulo) e loja aberta/fechada pelo horário e pelos modos manuais.
-- Datas: 08/10/2026 é quinta; 09 sexta; 10 sábado; 11 domingo; 12 segunda; 13 terça; 14 quarta; 15 quinta; 16 sexta; 17 sábado; 18 domingo.
-- CONFIG (contrato C5, pedido do dono em 16/10): todos os dias das 18h à meia-noite (sexta e sábado também fecham à meia-noite)
-- e quarta fechada (null). A madrugada nunca é sobra do turno de ontem.
begin;
\ir _ajuda.sql

-- o horário do CONFIG, como o seed o grava
create function pg_temp.horario_config() returns jsonb language sql as $$
  select jsonb_build_object('0', '["18:00","00:00"]'::jsonb, '1', '["18:00","00:00"]'::jsonb, '2', '["18:00","00:00"]'::jsonb,
                            '3', 'null'::jsonb, '4', '["18:00","00:00"]'::jsonb, '5', '["18:00","00:00"]'::jsonb, '6', '["18:00","00:00"]'::jsonb)
$$;

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

-- o horário do seed é o do CONFIG: quarta null, o resto 18:00–00:00 (sexta e sábado também)
select pg_temp.ok((select jsonb_typeof(horarios -> '3') = 'null' from loja where id = 1), 'seed: quarta fechada (null)');
select pg_temp.ok((select horarios = pg_temp.horario_config() from loja where id = 1), 'seed: os outros dias 18:00–00:00, sexta e sábado também');

-- turno automático: segunda a domingo, as fronteiras
update loja set modo = 'auto';
select pg_temp.ok(not loja_aberta('2026-10-12 12:00-03'), 'segunda 12:00: fechada');
select pg_temp.ok(not loja_aberta('2026-10-12 17:59:59-03'), 'segunda 17:59:59: fechada');
select pg_temp.ok(loja_aberta('2026-10-12 18:00-03'), 'segunda 18:00: aberta');
select pg_temp.ok(loja_aberta('2026-10-12 20:00-03'), 'segunda 20:00: aberta');
select pg_temp.ok(loja_aberta('2026-10-12 23:59:59-03'), 'segunda 23:59:59: aberta');
select pg_temp.ok(not loja_aberta('2026-10-13 00:00-03'), 'terça 00:00: fechada, o turno de segunda acaba à meia-noite');
select pg_temp.ok(not loja_aberta('2026-10-13 00:30-03'), 'terça 00:30: fechada (o turno de segunda não passa da meia-noite)');
select pg_temp.ok(not loja_aberta('2026-10-13 17:59:59-03'), 'terça 17:59:59: fechada');
select pg_temp.ok(loja_aberta('2026-10-13 18:00-03'), 'terça 18:00: aberta');
select pg_temp.ok(loja_aberta('2026-10-13 23:59:59-03'), 'terça 23:59:59: aberta');

-- quarta: o dia todo fechada
select pg_temp.ok(not loja_aberta('2026-10-14 00:00-03'), 'quarta 00:00: fechada, o turno de terça acaba à meia-noite');
select pg_temp.ok(not loja_aberta('2026-10-14 00:30-03'), 'quarta 00:30: fechada');
select pg_temp.ok(not loja_aberta('2026-10-14 12:00-03'), 'quarta 12:00: fechada');
select pg_temp.ok(not loja_aberta('2026-10-14 17:59:59-03'), 'quarta 17:59:59: fechada');
select pg_temp.ok(not loja_aberta('2026-10-14 18:00-03'), 'quarta 18:00: fechada (nos outros dias já abriu)');
select pg_temp.ok(not loja_aberta('2026-10-14 20:00-03'), 'quarta 20:00: fechada');
select pg_temp.ok(not loja_aberta('2026-10-14 23:59-03'), 'quarta 23:59: fechada');
select pg_temp.ok(not loja_aberta('2026-10-14 23:59:59-03'), 'quarta 23:59:59: fechada');
select pg_temp.ok(not loja_aberta('2026-10-15 00:00-03'), 'quinta 00:00: fechada (a quarta não tem turno)');
select pg_temp.ok(not loja_aberta('2026-10-15 00:30-03'), 'quinta 00:30: fechada');
select pg_temp.ok(not loja_aberta('2026-10-15 17:59:59-03'), 'quinta 17:59:59: fechada');
select pg_temp.ok(loja_aberta('2026-10-15 18:00-03'), 'quinta 18:00: aberta, a loja volta depois da quarta');
select pg_temp.ok(loja_aberta('2026-10-15 23:59:59-03'), 'quinta 23:59:59: aberta');

-- sexta, sábado e domingo fecham à meia-noite como os outros dias (sem sobra de madrugada)
select pg_temp.ok(not loja_aberta('2026-10-16 00:30-03'), 'sexta 00:30: fechada, o turno de quinta acaba à meia-noite');
select pg_temp.ok(not loja_aberta('2026-10-16 17:59:59-03'), 'sexta 17:59:59: fechada');
select pg_temp.ok(loja_aberta('2026-10-16 18:00-03'), 'sexta 18:00: aberta');
select pg_temp.ok(loja_aberta('2026-10-16 23:00-03'), 'sexta 23:00: aberta');
select pg_temp.ok(loja_aberta('2026-10-16 23:59:59-03'), 'sexta 23:59:59: aberta');
select pg_temp.ok(not loja_aberta('2026-10-17 00:00-03'), 'sábado 00:00: fechada, o turno de sexta acaba à meia-noite');
select pg_temp.ok(not loja_aberta('2026-10-17 00:30-03'), 'sábado 00:30: fechada (sexta não tem sobra de madrugada)');
select pg_temp.ok(not loja_aberta('2026-10-17 01:00-03'), 'sábado 01:00: fechada');
select pg_temp.ok(not loja_aberta('2026-10-17 17:59:59-03'), 'sábado 17:59:59: fechada');
select pg_temp.ok(loja_aberta('2026-10-17 18:00-03'), 'sábado 18:00: aberta');
select pg_temp.ok(loja_aberta('2026-10-17 23:59:59-03'), 'sábado 23:59:59: aberta');
select pg_temp.ok(not loja_aberta('2026-10-18 00:00-03'), 'domingo 00:00: fechada, o turno de sábado acaba à meia-noite');
select pg_temp.ok(not loja_aberta('2026-10-18 00:30-03'), 'domingo 00:30: fechada (sábado não tem sobra de madrugada)');
select pg_temp.ok(not loja_aberta('2026-10-18 01:00-03'), 'domingo 01:00: fechada');
select pg_temp.ok(not loja_aberta('2026-10-18 17:59:59-03'), 'domingo 17:59:59: fechada');
select pg_temp.ok(loja_aberta('2026-10-18 18:00-03'), 'domingo 18:00: aberta (domingo abre)');
select pg_temp.ok(loja_aberta('2026-10-18 20:00-03'), 'domingo 20:00: aberta');
select pg_temp.ok(loja_aberta('2026-10-18 23:59:59-03'), 'domingo 23:59:59: aberta');
select pg_temp.ok(not loja_aberta('2026-10-19 00:00-03'), 'segunda 00:00: fechada, o turno de domingo acaba à meia-noite');
select pg_temp.ok(not loja_aberta('2026-10-19 00:30-03'), 'segunda 00:30: fechada (o turno de domingo não passa da meia-noite)');

-- fuso: vale o de São Paulo, não o do timestamp nem o da sessão
select pg_temp.ok(not loja_aberta('2026-10-17 20:30+00'), '20:30 UTC de sábado = 17:30 em SP: fechada (fuso aplicado)');
select pg_temp.ok(loja_aberta('2026-10-17 21:00+00'), '21:00 UTC de sábado = 18:00 em SP: aberta (fuso aplicado)');
select pg_temp.ok(not loja_aberta('2026-10-15 02:00+00'), '02:00 UTC de quinta = 23:00 de quarta em SP: fechada');
select pg_temp.ok(not loja_aberta('2026-10-17 03:30+00'), '03:30 UTC de sábado = 00:30 de sábado em SP: fechada');
set local timezone = 'Asia/Tokyo';
select pg_temp.ok(loja_aberta('2026-10-15 18:00-03') and not loja_aberta('2026-10-15 17:59:59-03'), 'o fuso da sessão não muda o horário (quinta 18:00 em SP)');
select pg_temp.ok(not loja_aberta('2026-10-14 20:00-03'), 'o fuso da sessão não muda a quarta');
reset timezone;

-- o mecanismo ainda entende turno que atravessa a meia-noite (o banco pode receber outro horário; o de hoje não usa)
update loja set horarios = '{"5":["18:00","01:00"]}';
select pg_temp.ok(loja_aberta('2026-10-17 00:30-03'), 'horário de teste, sexta 18h–1h: sábado 00:30 é a sobra do turno de sexta');
select pg_temp.ok(not loja_aberta('2026-10-17 01:00-03'), 'horário de teste, sexta 18h–1h: sábado 01:00 fechada');

-- dia sem turno (null) = fechado o dia todo
update loja set horarios = jsonb_set(pg_temp.horario_config(), '{0}', 'null');
select pg_temp.ok(not loja_aberta('2026-10-18 20:00-03'), 'domingo null: fechado às 20:00');
select pg_temp.ok(loja_aberta('2026-10-17 20:00-03'), 'domingo null: o sábado segue aberto às 20:00');

-- modos manuais com o horário do CONFIG: a válvula do dono vale também na quarta
update loja set horarios = pg_temp.horario_config();
update loja set modo = 'aberta';
select pg_temp.ok(loja_aberta('2026-10-14 20:00-03') and loja_aberta('2026-10-15 12:00-03'), 'modo aberta: aberta na quarta e fora do horário');
update loja set modo = 'fechada';
select pg_temp.ok(not loja_aberta('2026-10-15 20:00-03') and not loja_aberta('2026-10-16 23:00-03'), 'modo fechada: fechada dentro do horário');
update loja set modo = 'auto';

-- turnos de teste: o dia todo (00:00–00:00) e nenhum
update loja set horarios = '{"0":["00:00","00:00"],"1":["00:00","00:00"],"2":["00:00","00:00"],"3":["00:00","00:00"],"4":["00:00","00:00"],"5":["00:00","00:00"],"6":["00:00","00:00"]}';
select pg_temp.ok(loja_aberta('2026-10-18 12:00-03') and loja_aberta('2026-10-19 00:00-03'), 'turno 00:00–00:00 = aberta o dia todo');
update loja set horarios = '{"0":null,"1":null,"2":null,"3":null,"4":null,"5":null,"6":null}';
select pg_temp.ok(not loja_aberta('2026-10-16 23:00-03'), 'sem nenhum turno: fechada');
update loja set modo = 'aberta';
select pg_temp.ok(loja_aberta('2026-10-18 20:00-03'), 'modo aberta: aberta fora do horário (sem nenhum turno)');
update loja set modo = 'fechada', horarios = '{"5":["18:00","00:00"]}';
select pg_temp.ok(not loja_aberta('2026-10-16 23:00-03'), 'modo fechada: fechada dentro do horário (sexta 23:00)');
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

-- criar_pedido numa quarta à noite, loja em modo 'auto': loja_fechada. A função lê now(), que um teste não troca; então o dia de hoje
-- (em São Paulo) vira o dia sem turno, como a quarta do CONFIG, e o turno de ontem acaba à meia-noite: fechada a qualquer hora.
-- A quarta de verdade (14/10, 20:00) está nas verificações de loja_aberta() acima.
begin;
\ir _ajuda.sql
update loja set modo = 'auto', aceita_fechada = false,
  horarios = (select jsonb_object_agg(d::text,
                case when d = extract(dow from now() at time zone 'America/Sao_Paulo')::int then 'null'::jsonb else '["18:00","00:00"]'::jsonb end)
              from generate_series(0, 6) d);
select pg_temp.ok(not loja_aberta(now()), 'dia sem turno no auto: loja_aberta(now()) é falso');
select pg_temp.sou(null);
set local role anon;
select pg_temp.igual(pg_temp.erro_item('agua'), 'loja_fechada', 'dia sem turno (como a quarta), modo auto: anon recebe loja_fechada');
reset role;
select pg_temp.sou(:'estranho');
set local role authenticated;
select pg_temp.igual(pg_temp.erro_item('agua'), 'loja_fechada', 'dia sem turno, modo auto: logado de fora da equipe também recebe loja_fechada');
reset role;
select pg_temp.sou(:'equipe');
set local role authenticated;
select pg_temp.ok(pg_temp.erro_item('agua') is null, 'dia sem turno, modo auto: a equipe ignora o horário e cria o pedido');
reset role;
update loja set modo = 'aberta';
select pg_temp.sou(null);
set local role anon;
select pg_temp.ok(pg_temp.erro_item('agua') is null, 'dia sem turno com o modo aberta (a válvula do dono): aceita');
reset role;
rollback;
