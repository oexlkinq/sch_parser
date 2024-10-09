import 'dotenv/config'
import { scheduleJob } from "node-schedule";
import { Spider } from "./scheduleParser/spider.js";
import { updateTeachers } from "./scheduleParser/teachersImporter.js";
import { PairTextParser } from "./scheduleParser/pairTextParser.js";
import { Processor } from "./scheduleParser/processor.js";

let doInit = process.argv.includes('init');

if(doInit){
    console.log('updateTeachers...');
    
    await updateTeachers('eost.json');

    console.log('init updateTeachers done');
}
let textParser = await PairTextParser.makeParser();
// разбор информации о преподавателях
// каждый день в 1:20
scheduleJob('20 1 * * *', async () => {
    await updateTeachers('eost.json');
    textParser = await PairTextParser.makeParser();
});


if(doInit){
    console.log('check...');
    
    await check();

    console.log('init check done');
}
// каждые 5 минут с 6 до 25
scheduleJob('*/5 6-23,0 * * *', check);


// получение и обработка обновлений
async function check() {
    const list = await Spider.fetchUpdates();

    for (const item of list) {
        try {
            await Processor.process(item, textParser);
        } catch (err) {
            console.error(err);
        }
    }
}

console.log('started');
