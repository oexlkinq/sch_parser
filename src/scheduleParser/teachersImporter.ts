import { TeachersUtils } from '../db.js';
import { EduBaseApi } from 'node-edubase-api';

const eb = new EduBaseApi(process.env.EDUBASEAPI_TOKEN)

export async function updateTeachers() {
    const rawTeachers = await eb.api.getinfo.employee('*', { sitesearch: true })

    const teachers = rawTeachers.employee.filter(item => item.blocked === '0').map(item => ({
        login: item.login,
        name: item.fio,
        url: item.url,
    }))
    
    await TeachersUtils.importFromJson(JSON.stringify(teachers));
}
