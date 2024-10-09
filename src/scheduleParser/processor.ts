import { createHash } from "crypto";
import { ScheduleUtils, Utils } from "../db.js";
import { textParser } from "./pairTextParser.js";
import { fileInfo } from "./spider.js";
import { ScheduleParser, faculty } from "./parser.js";

export class Processor {
    static async process(fileInfo: fileInfo, textParser: textParser) {
        if (!fileInfo.faculty) {
            return;
        }

        const getBuffer = async () => {
            const resp = await fetch(fileInfo.link);
            return await resp.arrayBuffer();
        };

        let buffer: ArrayBuffer;
        if (!fileInfo.hash) {
            buffer = await getBuffer();

            const hasher = createHash('md5');
            hasher.update(Buffer.from(buffer));
            fileInfo.hash = hasher.digest('hex');
        }


        const oldInsertion = await ScheduleUtils.getInsertion(fileInfo.date, fileInfo.faculty);
        if (oldInsertion && oldInsertion.hash === fileInfo.hash) {
            return;
        }

        if (!buffer) {
            buffer = await getBuffer();
        }


        let insertion_id: number;
        let schedule: ScheduleParser;
        let involvedGroups: number[];
        const update = !!oldInsertion;

        await Utils.doTransaction(async () => {
            if (update) {
                //удалить insertion + все связанные пары тоже удалятся
                await ScheduleUtils.deleteInsertion(oldInsertion.id);
            }
            insertion_id = await ScheduleUtils.createInsertion(fileInfo.date, fileInfo.faculty, fileInfo.hash);

            schedule = new ScheduleParser(buffer, fileInfo.faculty as faculty, textParser, fileInfo.date);

            involvedGroups = await ScheduleUtils.processNewSchedule(schedule, insertion_id);
        });

        return {involvedGroups, update};
    }
}