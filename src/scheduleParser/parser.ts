import { CellAddress, CellObject, Range, WorkBook, WorkSheet } from 'xlsx/types';
import xlsx from 'xlsx';
import { SimpleError } from '../utils/errors.js';
import { Monday } from '../utils/monday.js';
import { textParser } from './pairTextParser.js';

type scheduleSource = string | ArrayBuffer;

class SimpleTable {
    workBook: WorkBook;
    targetSheet: WorkSheet;
    range: Range;

    constructor(source: scheduleSource, targetSheetIndex?: number) {
        if (typeof source === 'string') {
            this.workBook = xlsx.readFile(source, { type: 'file', raw: true });
        } else {
            this.workBook = xlsx.read(source, { raw: true });
        }
        //в типе Workbook нет свойства WBView, но оно доступно в рантайме
        // @ts-expect-error
        targetSheetIndex = targetSheetIndex ?? (this.workBook.Workbook?.WBView ?? [])[0]?.activeTab ?? 0;
        this.targetSheet = this.workBook.Sheets[this.workBook.SheetNames[targetSheetIndex]];
        this.range = xlsx.utils.decode_range(this.targetSheet['!ref']);
    }
}

export type groupName = string

export class Pair {
    text: string;
    num: number;
    groups: Set<groupName>;
    date: Date;

    subject: string;
    aud: string;
    teachers: number[];

    constructor(text: string, num: number, date: Date, groups: groupName[], subject: string, aud: string, teachers: number[]) {
        if (groups) {
            this.groups = new Set(groups);
        }
        this.text = text;
        this.num = num;
        this.date = date;

        this.subject = subject;
        this.aud = aud;
        this.teachers = teachers;
    }
}

type CellInfo = {
    cell: CellObject | undefined,
    addr: CellAddress,
}

type groupParams = {
    c: number,
    w: number
}

export class Schedule {
    faculty: faculty;
    date: Monday;
    groups: groupName[];
    pairs: Pair[];
}

export class ScheduleParser extends Schedule {
    static defaultParseOptions = {
        // TODO: rowsByClass должен определяться в detectLayout
        rowsByClass: 2,
        colsByGroup: 1,
        partedTime: false,
        minCountOfLastDayClasses: 1,
        maxCountOfEmptyCols: 2,
    };

    private table: SimpleTable;
    private parseOptions: parseOptions;

    constructor(source: scheduleSource, faculty: faculty, textParser: textParser, date?: Monday) {
        super();

        if (!(faculty in allopts)) {
            throw new ParsingError(`нет конфигурации для факультета "${faculty}"`);
        }

        this.faculty = faculty;
        this.parseOptions = Object.assign({}, ScheduleParser.defaultParseOptions, allopts[faculty]);
        this.date = date;
        if (!date) {
            console.warn('дата не была передана явно');
        }


        // дальше идёт блок который выбирает, что нужно парсить: каждый по порядку (в приоритете активный, если есть) пока не успешно, либо выбросить ошибку про парсинг 0
        let workBook: WorkBook;
        if (typeof source === 'string') {
            workBook = xlsx.readFile(source, { type: 'file', raw: true });
        } else {
            workBook = xlsx.read(source, { raw: true });
        }

        let sheetNames = workBook.SheetNames.slice();
        //в типе Workbook нет свойства WBView, но оно доступно в рантайме
        // @ts-expect-error
        const activeTab = (workBook.Workbook?.WBView ?? [])[0]?.activeTab as number;
        if (activeTab !== undefined) {
            // если есть активный лист, то переместить его на первую позицию, чтобы попробовать спарсить его первым
            sheetNames[activeTab] = sheetNames[0];
            sheetNames[0] = workBook.SheetNames[activeTab];
        }

        // здесь проходит проверка каждого листа на указанный для факультета макет
        let errors = [];
        for (const sheetName of sheetNames) {
            this.table = {
                workBook,
                targetSheet: workBook.Sheets[sheetName],
                range: xlsx.utils.decode_range(workBook.Sheets[sheetName]['!ref']),
            };

            try {
                this.parseOptions = Object.assign({}, this.parseOptions, this.detectLayout());
                this.parsePairs(textParser);
                errors = [];

                break;
            } catch (e) {
                errors.push(e);
            }
        }

        // TODO: нужно возвращать все ошибки
        if (errors.length === sheetNames.length) {
            console.error(errors);
            throw errors[0];
        }
    }

    /** сокращение xlsx.utils.encode_cell */
    static i2l(cellAddr: CellAddress) {
        return xlsx.utils.encode_cell(cellAddr);
    }

    static isCellInRange(cellAddr: CellAddress, range: Range) {
        return range.s.r <= cellAddr.r
            && range.s.c <= cellAddr.c
            && range.e.r >= cellAddr.r
            && range.e.c >= cellAddr.c;
    }

    findInMerges(cellAddr: CellAddress) {
        const merges = this.table.targetSheet['!merges'];
        if (merges) {
            for (let merge of merges) {
                if (ScheduleParser.isCellInRange(cellAddr, merge)) {
                    return merge.s;
                }
            }
        }
    }

    getCellByAddr(cellAddr: CellAddress): CellObject {
        return this.table.targetSheet[ScheduleParser.i2l(cellAddr)];
    }

    getCell(cellAddr: CellAddress): CellInfo {
        //ищем ячейку по исходному адресу
        let nonMerged: CellObject = this.getCellByAddr(cellAddr);
        if (nonMerged) return { cell: nonMerged, addr: cellAddr };

        //проверяем есть ли ячейка в объединениях
        let mergeAddr = this.findInMerges(cellAddr);
        if (mergeAddr) return { cell: this.getCellByAddr(mergeAddr), addr: mergeAddr };

        return { cell: undefined, addr: cellAddr };
    }

    forEachInRange(range: Range, handler: (cell: CellObject, addr: CellAddress) => boolean | void) {
        for (let c = range.s.c; c <= range.e.c; c++) {
            for (let r = range.s.r; r <= range.e.r; r++) {
                const addr = { c, r };
                const cell = this.getCellByAddr(addr);

                if (cell) {
                    if (handler(cell, addr) === false) {
                        return;
                    }
                }
            }
        }
    }

    detectLayout() {
        const findBlock = (checkRange: Range, testRegexp: RegExp, direction: 'down' | 'right') => {
            let targetAddr: CellAddress;
            this.forEachInRange(checkRange, (cell, addr) => {
                if (cell.w && testRegexp.test(cell.w)) {
                    // здесь происходит дополнительная проверка найденного диапазона

                    // создаётся подобласть, началом которой является текущий адрес, а концом - конец строки или столбца (при direction right или down соотв) ограниченный изначальной областью
                    const subCheckRange = { s: addr, e: (direction === 'down') ? { c: addr.c, r: checkRange.e.r } : { c: checkRange.e.c, r: addr.r } };

                    // для этой области считается кол-во подходящих ячеек
                    let correctCellsCount = 0;
                    this.forEachInRange(subCheckRange, (cell) => {
                        if (cell.w && testRegexp.test(cell.w)) {
                            correctCellsCount++;
                        }
                    });

                    // и если их больше половины, то поиск УСПЕШНО завершается
                    // минимальное возможное пороговое значение появляется при шаге 2 и равно 0.5. для шага 1 оно должно быть равно 1. лишние пробелы здесь учесть не получится, т.к. полный диапазон блоков ещё не определён и рассматривается только его часть
                    const ratio = correctCellsCount / (subCheckRange.e.r - subCheckRange.s.r + 1);
                    if (ratio >= 0.5) {
                        targetAddr = addr;
                        return false;
                    }
                }
            });

            return targetAddr;
        };

        // обычно начала блоков находятся в этом диапазоне
        const checkRange = { s: { c: 0, r: 0 }, e: { c: 9, r: 16 } };
        const timesBlockAddr = findBlock(checkRange, ScheduleParser.timeRegex, 'down');
        if (!timesBlockAddr) {
            throw new Error('столбец времени не обнаружен');
        }

        // TODO: лучше не искать закономерность, а парсить столбец времён и для каждой строки относительно её времени 
        let rowsByClass = 2;
        for(let shift = 1; shift <= 2; shift++){
            const nextCell = this.getCell({ c: timesBlockAddr.c, r: timesBlockAddr.r + shift });
            if (
                nextCell.cell
                && (nextCell.addr.c !== timesBlockAddr.c
                    || nextCell.addr.r !== timesBlockAddr.r)
                && ScheduleParser.timeRegex.test(nextCell.cell.w)
            ) {
                rowsByClass = shift;
                break;
            }
        }

        const groupsBlockAddr = findBlock(
            {
                s: {
                    c: timesBlockAddr.c + 1,
                    r: checkRange.s.r
                },
                e: {
                    c: checkRange.e.c,
                    r: timesBlockAddr.r - 1
                }
            },
            ScheduleParser.groupRegex, 'right'
        );
        if (!groupsBlockAddr) {
            throw new Error('столбец групп не обнаружен');
        }

        const pairsBlockAddr = { c: groupsBlockAddr.c, r: timesBlockAddr.r };
        return {
            startPoints:{
                times: timesBlockAddr,
                groups: groupsBlockAddr,
                pairs: pairsBlockAddr,
            },
            rowsByClass,
        };
    }

    static timeRegex = /(?<![\.\d])0*(\d{1,2})[:\.]\d{1,2}(?![\.\d])(?: *[\- .] *\d{1,2}[:\.]\d{1,2})?/;
    static dateRegex = /(?:\d{2}[./]){2}\d{2,4}/;
    parseDays(): Range[] {
        const forceSaturdayClassesCount = !!this.parseOptions.minCountOfLastDayClasses;

        let dtr: Range[] = [], tday = -1, lastOkRow = this.parseOptions.startPoints.times.r;
        let dateFound = !!this.date;

        for (let tpos = Object.assign({}, this.parseOptions.startPoints.times); tpos.r < this.table.range.e.r; tpos.r += this.parseOptions.rowsByClass) {
            let tcell = this.getCell(tpos);
            if (tcell.cell?.w?.trim().match(ScheduleParser.timeRegex)) {
                let cellText = tcell.cell.w;
                if (this.parseOptions.partedTime) {
                    let rightCell = this.getCell({ c: tpos.c + 1, r: tpos.r }).cell;
                    if (rightCell) {
                        cellText += `:${rightCell.w}`;
                    }
                }
                const timeTest = ScheduleParser.timeRegex.exec(cellText);
                if (timeTest && timeTest[1] === '8') {
                    dtr[++tday] = {
                        s: {
                            c: this.parseOptions.startPoints.times.c,
                            r: tpos.r
                        },
                        e: {
                            c: this.parseOptions.startPoints.times.c,
                            r: tpos.r
                        }
                    };
                }
                lastOkRow = tpos.r;
            } else {//ячейка не валидна
                const isSaturday = tday === 5;
                if (isSaturday) {
                    if (forceSaturdayClassesCount) {
                        /** номер последней строки группы строк текущей пары */
                        const lastRowOfClassRowRange = tpos.r + (this.parseOptions.rowsByClass - 1);
                        /** количество строк текущего дня  */
                        const countOfRowsOfTempDay = lastRowOfClassRowRange - dtr[tday].s.r + 1;
                        /** целевое количество строк в последнем дне */
                        const targetCountOfRowsOfLastDay = this.parseOptions.minCountOfLastDayClasses * this.parseOptions.rowsByClass;

                        const enoughRows = countOfRowsOfTempDay >= targetCountOfRowsOfLastDay;

                        if (!enoughRows) {
                            lastOkRow = tpos.r;
                            continue;
                        }
                    }
                    //завершаем день
                    dtr[tday].e.r = lastOkRow + this.parseOptions.rowsByClass - 1;
                    //завершаем неделю
                    break;
                } else {
                    //завершаем день
                    dtr[tday].e.r = lastOkRow + this.parseOptions.rowsByClass - 1;
                    //переходим на ячейку, при которой нормальное смещение (+=this.parseOptions.rowsByClass) правильно перейдёт на нужную ячейку
                    tpos.r += 1 - this.parseOptions.rowsByClass;
                }
            }
        }

        return dtr;
    }

    static groupRegex = /(?<=\s|^)(\d-?\d\d) ?([мбс])(?: ?([-/]) ?([а-я0-9]))?(?=\s|$)/i;

    /** возвращает позицию и ширину групп */
    parseGroups() {
        let gtc = new Map<string, groupParams>();
        let lastGroup: string | undefined;

        for (let tpos = Object.assign({}, this.parseOptions.startPoints.groups); tpos.c <= this.table.range.e.c; tpos.c += this.parseOptions.colsByGroup) {
            let tcell = this.getCell(tpos);
            const cellText = tcell.cell?.w;

            let groupText: string;
            if(cellText){
                // нормализация названия группы
                const matchRes = ScheduleParser.groupRegex.exec(cellText);

                groupText = matchRes?.slice(1).join('').toLocaleLowerCase();
            }

            if (groupText) {
                // если группа совпадает с предыдущей ячейкой
                if (groupText === lastGroup) {
                    gtc.get(lastGroup).w += this.parseOptions.colsByGroup;
                } else {
                    gtc.set(groupText, { c: tpos.c, w: this.parseOptions.colsByGroup });
                    lastGroup = groupText;
                }
            } else {
                // текст ячейки не группа - либо конец, либо пробел между группами
                let lastOkCol: number | undefined;
                // поиск валидной ячейки впереди
                for (let i = 1; i <= this.parseOptions.maxCountOfEmptyCols; i++) {
                    let cell = this.getCell({ c: tpos.c + i, r: tpos.r }).cell;
                    if (cell && ScheduleParser.groupRegex.test(cell.w || '')) {
                        lastOkCol = tpos.c + i;
                        break;
                    }
                }
                if (lastOkCol) {
                    //впереди ещё есть валидные ячейки
                    //изменяем позицию так чтобы следующее нормальное смещение привело к валидной ячейке
                    tpos.c = lastOkCol - this.parseOptions.colsByGroup;
                } else {
                    break;
                }
            }
        }

        return gtc;
    }

    parsePairs(textParser: textParser) {
        const dtr = this.parseDays();
        const gtc = this.parseGroups();

        //названия пар по колонкам-строкам
        let cbi = new Map<string, Pair>();

        //обход дней
        for (let day = 0; day < dtr.length; day++) {
            //диапазон дня
            const dayRange = dtr[day];

            //обход групп
            for (let group of gtc.keys()) {
                const groupParams = gtc.get(group);

                //обход пар дня
                for (let row = dayRange.s.r, pairNum = 1; row <= dayRange.e.r; row += this.parseOptions.rowsByClass, pairNum++) {
                    //обход столбцов принадлежащих группе
                    for (let j = 0; j < groupParams.w; j += this.parseOptions.colsByGroup) {
                        let col = groupParams.c + j;
                        let stc = this.getCell({ c: col, r: row });

                        let fullText = stc.cell?.w?.trim() || '';

                        if (this.parseOptions.rowsByClass === 2) {
                            let ndc = this.getCell({ c: col, r: row + 1 });
                            const ndcText = ndc.cell?.w?.trim();

                            fullText = (fullText && ndcText) ? (fullText + ' / ' + ndcText) : fullText || ndcText || '';
                        }

                        if (fullText) {
                            if (this.parseOptions.replaceExtraSpacesBy) {
                                fullText = fullText.replaceAll(/ {2,}/g, this.parseOptions.replaceExtraSpacesBy);
                            }

                            let pairIdentity = `${fullText}#${row}`;
                            if (!cbi.has(pairIdentity)) {
                                let pairDate = new Date(this.date.date);
                                pairDate.setDate(pairDate.getDate() + day);

                                const {subject, aud, teachers} = textParser(fullText);
                                const pair = new Pair(fullText, pairNum, pairDate, [group], subject, aud, teachers);

                                cbi.set(pairIdentity, pair);
                            } else {
                                cbi.get(pairIdentity).groups.add(group);
                            }
                        }
                    }
                }
            }
        }

        this.pairs = Array.from(cbi.values());
        this.groups = Array.from(gtc.keys());
    }
}

type parseOptions = {
    startPoints: {
        times: CellAddress,
        groups: CellAddress,
        pairs: CellAddress,
    },
    rowsByClass?: number,
    colsByGroup?: number,
    minCountOfLastDayClasses?: number,
    maxCountOfEmptyCols?: number,
    partedTime?: boolean,
    replaceExtraSpacesBy?: string,
    subgroupCheck?: boolean,
};
export type faculty = keyof typeof allopts;
const allopts = {
    ff: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 8 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
        subgroupCheck: true,
    },
    iittien: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 8 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
        subgroupCheck: true,
    },
    gumin: {
        startPoints: {
            times: { c: 2, r: 10 },
            groups: { c: 3, r: 6 },
            pairs: { c: 3, r: 10 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
        subgroupCheck: true,
    },
    pp: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 8 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
        subgroupCheck: true,
        replaceExtraSpacesBy: ' / ',
    },
    college: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 8 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
        subgroupCheck: true,
    },
    
    college_z: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 8 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
        subgroupCheck: true,
    },

    gumin_zb: {
        startPoints: {
            times: { c: 1, r: 9 },
            groups: { c: 2, r: 7 },
            pairs: { c: 2, r: 9 },
        },
        replaceExtraSpacesBy: ' / ',
    },
    gumin_zm: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 6 },
            pairs: { c: 2, r: 8 },
        },
        replaceExtraSpacesBy: ' / ',
    },

    iittien_zb: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 8 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
    },
    iittien_zm: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 8 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
    },

    ff_zb: {
        startPoints: {
            times: { c: 1, r: 7 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 7 },
        },
    },

    ff_zm: {
        startPoints: {
            times: { c: 1, r: 7 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 7 },
        },
    },

    pp_zb: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 8 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
        subgroupCheck: true,
    },

    pp_zm: {
        startPoints: {
            times: { c: 1, r: 8 },
            groups: { c: 2, r: 5 },
            pairs: { c: 2, r: 8 },
        },
        rowsByClass: 2,
        minCountOfLastDayClasses: 4,
        subgroupCheck: true,
    },
};
export const faculties = Object.keys(allopts) as faculty[];

export class ParsingError extends SimpleError { }
