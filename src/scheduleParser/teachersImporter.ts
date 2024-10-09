import { readFile } from 'node:fs/promises';
import { TeachersUtils } from '../db.js';

type rawTeacher = {
    ID: string;
    peoplename: string;
    ruledAcademicGroups: string;
    eoslogin: string;
    roles: string;
    email: string;
    orgunitname: string;
    jobtypename: string;
    instaff: string;
    status: string;
    creator: string;
    creatorTS: string;
    updator: string;
    updatorTS: string;
    url: string;
};

export async function updateTeachers(path: string) {
    const rawjson = await readFile(path, 'utf-8');
    const rawTeachers = JSON.parse(rawjson) as rawTeacher[];

    const teachers = rawTeachers.map((teacher) => ({
        id: +teacher.ID,
        name: teacher.peoplename,
        url: teacher.url,
    }));
    
    await TeachersUtils.importFromJson(JSON.stringify(teachers));
}
