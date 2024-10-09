import { faculty } from "./parser.js";
import { SimpleError } from "../utils/errors.js";
import { Monday } from "../utils/monday.js";

export type fileInfo = {
    hash?: string,
    link: string,
    faculty?: faculty,
    date: Monday,
}
export class Spider{
    static async fetchUpdates(startDate?: Monday): Promise<fileInfo[]>{
        startDate = startDate ?? new Monday();

        const url = new URL(this.futureApiLink);
        url.search = startDate.date.toLocaleDateString('ru');

        const resp = await fetch(url);
        const rawList = await resp.json() as string[];

        return rawList.map(v => {
            const [rawHash, rawLink] = v.split('  ');
            const {link, faculty, date} = this.getFileInfo(rawLink);

            const hash = (rawHash === '-') ? undefined : rawHash;

            return {
                hash,
                link,
                faculty,
                date,
            };
        });
    }

    static futureApiLink = 'http://shgpi.edu.ru/fileadmin/future.md5.php';

    static getFileInfo(rawLink: string){
        const middlePath = rawLink.split('/').slice(0,3).join('/');
        const faculty = this.facsByMiddlePathMap.get(middlePath);
        
        const dateRange = rawLink.split('/').at(-2);
        const [d, m, y] = dateRange.split('_');
        const date = new Monday(Date.UTC(+y, +m - 1, +d, 0, 0, 0, 0));

        const link = 'http://shgpi.edu.ru/fileadmin/' + rawLink;

        return {
            link,
            faculty,
            date,
        };
    }

    static async fetchSchedule(faculty: faculty, monday: Monday){
        let resp: Response;
        const links = Spider.makePaths(monday, faculty);
        for(let i = 0; i < 2; i++){
            const link = links[i];
            
            resp = await fetch(link);
            if(!resp.ok){
                if(resp.status === 404){
                    if(i === 0){
                        continue;
                    }
                    throw new UnavailableError('расписание недоступно');
                }else{
                    console.error(resp);
                    throw new Error('неизвестная ошибка');
                }
            }
            
            break;
        }

        return resp.arrayBuffer();
    }

    static makePaths(monday: Monday, faculty: faculty){
        const encodedDate = Spider.encodeDate(monday);
        const noxLink = `http://shgpi.edu.ru/fileadmin/${Spider.middlePathByFacsMap.get(faculty)}/${encodedDate}/${encodedDate}.xls`;

        return [noxLink, noxLink + 'x'];
    }

    static encodeDate(monday: Monday){
        let sunday = new Date(monday.date);
        sunday.setDate(monday.date.getDate() + 6);

        return monday.date.toLocaleDateString().replaceAll('.', '_')
            + '_'
            + sunday.toLocaleDateString().replaceAll('.', '_');
    }

    static middlePathToFacs = [
        ['gumin', 'rasp/faculty/f12'],
        ['pp', 'rasp/faculty/f08'],
        ['iittien', 'rasp/faculty/f11'],
        ['ff', 'rasp/faculty/f03'],
        ['college', 'rasp/faculty/f15'],
        
        ['gumin_zb', 'rasp_zao/faculty/f07'],
        ['gumin_zm', 'rasp_zao_mag/faculty/f07'],
        
        ['iittien_zb', 'rasp_zao/faculty/f11'],
        ['iittien_zm', 'rasp_zao_mag/faculty/f11'],
        
        ['ff_zb', 'rasp_zao/faculty/f03'],
        ['ff_zm', 'rasp_zao_mag/faculty/f03'],
        
        ['pp_zb', 'rasp_zao/faculty/f08'],
        ['pp_zm', 'rasp_zao_mag/faculty/f08'],

        // ['college_z', 'rasp_zao/faculty/f15'],
    ] as [faculty, string][];
    static middlePathByFacsMap = new Map<faculty, string>(Spider.middlePathToFacs);
    static facsByMiddlePathMap = new Map<string, faculty>(Spider.middlePathToFacs.map(v => [v[1], v[0]]));
}

export class UnavailableError extends SimpleError{}