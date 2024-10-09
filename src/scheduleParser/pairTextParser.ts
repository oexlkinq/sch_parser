import { TeachersUtils } from '../db.js';

export type textParser = (text: string) => {
    subject: string;
    aud: string;
    teachers: number[];
};
export class PairTextParser{
    static async makeParser(): Promise<textParser> {
        const rawTeachers = await TeachersUtils.getAllTeachers();

        const teachers = rawTeachers.map((v) => {
            const parts = v.name.replace(/ ?\(.+?\) ?/, ' ').split(' ');

            if(parts.length < 3){
                return;
            }

            return {
                id: v.id,
                pattern: `(${parts[0]} ${parts[1][0]}\\. ?${parts[2][0]}\\.?)`,
            };
        }).filter(v => v !== undefined);
        const pattern = teachers.map(v => v.pattern).join('|');

        const teachersRegexp = new RegExp(pattern, 'g');

        return (text: string) => {
            let idOfPairTeachers = [] as number[];
            let aud: string;

            let modifiedText = text;
            let matches: RegExpExecArray | RegExpMatchArray;
            while((matches = teachersRegexp.exec(text)) !== null){
                const index = matches.findIndex((v, i) => v !== undefined && i > 0);
                if(index !== -1){
                    idOfPairTeachers.push(teachers[index - 1].id);
                    modifiedText = modifiedText.replace(matches[0], '');
                }
            }

            matches = modifiedText.match(this.audRegexp);
            if(matches){
                aud = matches.slice(1).join('');
                modifiedText = modifiedText.replace(matches[0], '');
            }

            let subject = modifiedText.replaceAll(/ *\(\s*\) *|^(?: *\/ *)+|(?: *\/ *)+$| {2,}/g, ' ').trim();

            return {
                subject,
                aud,
                teachers: idOfPairTeachers,
            };
        };
    }

    static audRegexp = /(\d{3})(?: ?([а-в]))?|(zoom)|(эиос)|(кванториум)/i;
}
