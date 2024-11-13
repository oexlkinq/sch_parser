import pg from 'pg';
import { Schedule } from './scheduleParser/parser.js';
import { Monday } from './utils/monday.js';

export const client = new pg.Client(process.env.PG_CONNECTION_STRING);

await client.connect();
client.on('end', () => {
    setTimeout(() => {
        client.connect();
    }, 10000);
});
process.on('beforeExit', client.end);

export type DBPair = {
    text: string,
    num: number,
};

export class ScheduleUtils {
    /** ТОЛЬКО В СВЯЗКЕ С doTransaction */
    static async processNewSchedule(schedule: Schedule, insertion_id: number) {
        const data = JSON.stringify(schedule.pairs.map(pair => Object.assign({}, pair, {groups: Array.from(pair.groups), date: pair.date.toLocaleDateString('ru')})));
        const res = await client.query<{id: number}, [string, number]>('select id from import_pairs($1, $2)', [data, insertion_id]);

        return res.rows.map(row => row.id);
    }

    static async getInsertion(date: Monday, faculty: string) {
        const res = await client.query<{ id: number, date: Monday, faculty_id: number, hash: string }, [Date, string]>({
            text: 'select * from insertions where date = $1 and faculty_id = (select id from faculties where name = $2)',
            values: [date.monday, faculty],
        });

        return res.rows[0];
    }

    static async deleteInsertion(insertion_id: number) {
        const res = await client.query<never, [number]>({
            text: 'delete from insertions where id = $1',
            values: [insertion_id],
        });

        return res.rowCount;
    }

    static async createInsertion(date: Monday, faculty: string, hash: string) {
        let insres = await client.query<{ id: number }, [Date, string, string]>({
            text: `
                insert into insertions (date, faculty_id, hash) values ($1, (
                    select id from faculties where name = $2
                ), $3) returning id
            `,
            values: [date.monday, faculty, hash],
        });

        return insres.rows[0].id;
    }
}

export type Teacher = {
    name: string,
    url: string,
};
export type DBTeacher = { id: number } & Teacher;
export class TeachersUtils {
    static async getAllTeachers() {
        const res = await client.query<DBTeacher>('select * from teachers');

        return res.rows;
    }

    static async importFromJson(json: string) {
        await Utils.doTransaction(async () => {
            // TODO: вместо двух join можно использовать один full join в котором выбрать оба типа исключительных случаев. вероятно, последующие сканирования маленькой таблицы только с изменениями в delete и insert обойдутся дешевле
            await client.query('create temp table newteachers on commit drop as select (jsonb_populate_record(null::teachers, value)).* from jsonb_array_elements($1)', [json]);
            await client.query(`delete from teachers as src using teachers as t left join newteachers as nt on nt.login = t.login where src.login = t.login and nt.login is null;
insert into teachers(name, url, login) select nt.name, nt.url, nt.login from teachers t right join newteachers as nt on nt.login = t.login where t.login is null;`);
        });
    }
}

export class Utils {
    static async doTransaction<T>(func: () => Promise<T> | T) {
        try {
            await client.query('begin');

            const res = await func();

            await client.query('commit');

            return res;
        } catch (err) {
            await client.query('rollback');
            throw err;
        }
    }
}
