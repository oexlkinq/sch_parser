import { PairTextParser } from "./scheduleParser/pairTextParser.js";
import { Processor } from "./scheduleParser/processor.js";
import { Spider, fileInfo } from "./scheduleParser/spider.js";
import { Monday } from "./utils/monday.js";
import {writeFile} from 'node:fs/promises';
import 'dotenv/config'

// для чего скрипт? для импорта всего доступного расписания, начиная с указанной даты

const list = await Spider.fetchUpdates(new Monday(process.argv[2]));

let res = new Map<string, [fileInfo, unknown][]>();
const addRes = (name: string, file: fileInfo, addInfo: unknown) => {
    let arr = res.get(name) ?? [];
    arr.push([file, addInfo]);
    res.set(name, arr);
}

const textParser = await PairTextParser.makeParser();

// await Promise.allSettled(list.map(async file => {
//     try{
//         await Processor.process(file, textParser);

//         addRes('ok', file, 'ok');
//         console.log(`${file.date.toLocaleDateString()} ${file.faculty} ok`);
//     }catch(e){
//         addRes(e.name, file, String(e));
//         console.log(`${file.date.toLocaleDateString()} ${file.faculty} err`);
//     }
// }));

for(const file of list){
    try{
        await Processor.process(file, textParser);

        addRes('ok', file, 'ok');
        console.log(`${file.date.date.toLocaleDateString()} ${file.faculty} ok`);
    }catch(e){
        addRes(e.name, file, String(e));
        console.log(`${file.date.date.toLocaleDateString()} ${file.faculty} err`);
    }
};

await writeFile('process.json', JSON.stringify(Object.fromEntries(res)));

process.exit();
