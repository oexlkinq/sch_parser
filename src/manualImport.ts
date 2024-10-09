import { ScheduleUtils, Utils } from "./db.js";
import { PairTextParser } from "./scheduleParser/pairTextParser.js";
import { createHash } from 'node:crypto';
import { ScheduleParser, faculty } from "./scheduleParser/parser.js";
import { Monday } from "./utils/monday.js";
import {readFile} from 'node:fs/promises';

// для чего скрипт? для ручного импорта файла

if (process.argv.length < 5) {
    console.log(`неверное кол-во параметров

синтаксис: node manualImport.js file date faculty [force|append]
file - путь к xls/xlsx файлу
date - дата в формате гггг-мм-дд
faculty - короткое название факультета
режим импорта:
    update - в этом режиме, при наличии, старое расписание будет удалено и затем добавлено новое
    append - данные из нового расписания будут добавлены к старому БЕЗ ПРОВЕРКИ НА ДУБЛИКАТЫ
    режим может отсутствовать, что вызовет ошибку при наличии старого расписания`);
    
    process.exit(1);
}

const [filepath, rawdate, faculty, reimportMode] = process.argv.slice(2) as [string, string, faculty, 'append' | 'update' | undefined];

const b = await readFile(filepath);
let buffer: ArrayBuffer = b;

const hasher = createHash('md5');
hasher.update(b);
const hash = hasher.digest('hex');
const date = new Monday(rawdate);

const oldInsertion = await ScheduleUtils.getInsertion(date, faculty);

let insertion_id: number;
let schedule: ScheduleParser, involvedGroups: number[];
await Utils.doTransaction(async () => {
    if(oldInsertion){
        if(!reimportMode){
            console.error(`уже загружено (insertion_id = ${oldInsertion.id})`);

            process.exit(1);
        }else if(reimportMode === 'append'){
            insertion_id = oldInsertion.id;
        }else if(reimportMode === 'update'){
            await ScheduleUtils.deleteInsertion(oldInsertion.id);
            insertion_id = await ScheduleUtils.createInsertion(date, faculty, hash);
        }

        console.log(reimportMode);
    }else{
        insertion_id = await ScheduleUtils.createInsertion(date, faculty, hash);
    }

    const textParser = await PairTextParser.makeParser();
    schedule = new ScheduleParser(buffer, faculty as faculty, textParser, date);

    involvedGroups = await ScheduleUtils.processNewSchedule(schedule, insertion_id);
});

console.log([filepath, rawdate, faculty, insertion_id, 'ok'].join(' '));

process.exit();
