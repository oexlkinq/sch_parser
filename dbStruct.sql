create table faculties(
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    name text not null unique,
    display_name text not null,
    short_display_name text not null
);

create table insertions(
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    date date not null,
    faculty_id integer not null references faculties(id) on delete cascade on update cascade,
    hash text
);

create table pairs(
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    text text not null,
    num integer not null,
    date date not null,
    subject text not null,
    aud text,
    insertion_id integer not null references insertions(id) on delete cascade on update cascade
);
create index on pairs(date);
create index on pairs(insertion_id);

create table groups(
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    name text not null unique,
    faculty_id integer not null references faculties(id)
);

create table groupsOfPairs(
    group_id integer not null references groups(id) on delete cascade on update cascade,
    pair_id integer not null references pairs(id) on delete cascade on update cascade
);
create index if not exists gop_pair_id_index on groupsOfPairs(pair_id);
create index if not exists gop_group_id_index on groupsOfPairs(group_id);

create table teachers (
    id INTEGER GENERATED ALWAYS AS IDENTITY,
    login text not null unique,
    name text not null unique,
    url text,
    PRIMARY KEY(id)
);

create table teachersOfPairs (
    teacher_id integer not null references teachers(id) on delete cascade on update cascade,
    pair_id integer not null references pairs(id) on delete cascade on update cascade
);
create index if not exists top_pair_id_index on teachersOfPairs(pair_id);
create index if not exists top_teacher_id_index on teachersOfPairs(teacher_id);

create type botpairs as (
    text text,
    num int,
    groups jsonb,
    date date,
    subject text,
    aud text,
    teachers jsonb
);

create or replace function import_pairs(input jsonb, insertion_id int) returns table(id int) as $$
declare
    pair record;
    pair_id bigint;
    dbgp text;
begin
    create unlogged table newpairs as select * from jsonb_populate_recordset(null::botpairs, input);
    create unlogged table newgroup_names as select distinct jsonb_array_elements_text(groups) as name from newpairs;

    -- добавить в базу новые группы
    insert into groups (name, faculty_id)
    select ngn.name, (select i.faculty_id from insertions i where i.id = insertion_id) as faculty_id
    from newgroup_names ngn
    left join groups g on g.name = ngn.name
    where g.name is null;

    for pair in
        select * from newpairs
    loop
        -- добавить пару и записать её id
        insert into pairs (text, num, date, insertion_id, subject, aud) values (
            pair.text,
            pair.num,
            pair.date,
            insertion_id,
            pair.subject,
            pair.aud
        )
        returning pairs.id into pair_id;

        -- добавить в базу связи пара-группа
        insert into groupsofpairs (pair_id, group_id)
        select pair_id, g.id as group_id
        from groups g
        join jsonb_array_elements_text(pair.groups) pg on pg.value = g.name;

        -- добавить в базу связи пара-препод
        insert into teachersofpairs (pair_id, teacher_id)
        select pair_id, value::int
        from jsonb_array_elements(pair.teachers);
    end loop;

    return query
    select g.id from groups g
    join newgroup_names ngn on ngn.name = g.name;

    drop table newgroup_names, newpairs;
end;
$$ language plpgsql;

INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (1, 'ff', 'Факультет физической культуры', 'ФФ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (2, 'pp', 'Институт психологии и педагогики', 'ИПиП');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (3, 'college', 'Университетский колледж', 'УК');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (4, 'iittien', 'Институт информационных технологий, точных и естественных наук', 'ИИТТиЕН');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (5, 'gumin', 'Гуманитарный институт', 'ГИ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (6, 'gumin_zb', 'Гуманитарный институт (заочное, бакалавриат)', 'ГИ ЗБ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (7, 'gumin_zm', 'Гуманитарный институт (заочное, магистратура)', 'ГИ ЗМ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (8, 'iittien_zb', 'Институт информационных технологий, точных и естественных наук (заочное, бакалавриат)', 'ИИТТиЕН ЗБ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (9, 'iittien_zm', 'Институт информационных технологий, точных и естественных наук (заочное, магистратура)', 'ИИТТиЕН ЗМ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (10, 'ff_zb', 'Факультет физической культуры (заочное, бакалавриат)', 'ФФ ЗБ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (11, 'pp_zb', 'Институт психологии и педагогики (заочное, бакалавриат)', 'ИПиП ЗБ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (12, 'pp_zm', 'Институт психологии и педагогики (заочное, магистратура)', 'ИПиП ЗМ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (13, 'ff_zm', 'Факультет физической культуры (заочное, магистратура)', 'ФФ ЗМ');
INSERT INTO public.faculties (id, name, display_name, short_display_name) VALUES (14, 'college_z', 'Университетский колледж (заочное)', 'УК З');
