import 'dotenv/config'
import { client } from "./db.js"
import { Spider } from "./scheduleParser/spider.js"
import { Monday } from "./utils/monday.js"
import { Processor } from './scheduleParser/processor.js'
import { PairTextParser } from './scheduleParser/pairTextParser.js'

// считать все параметры как id
const targetIds = process.argv.slice(2).map((arg, i) => {
    const num = +arg
    if (isNaN(num)) {
        throw new Error(`${i + 1} id is NaN`)
    }

    return num
})

// достать из бд инфу о файлах
const res = await client.query<{ id: number, date: Date, fac_name: string, hash: string }>(`
    select i.id, i.date, f.name as fac_name, i.hash
    from insertions i
    inner join faculties f on f.id = i.faculty_id
    where i.id = ANY (ARRAY [${targetIds.join(',')}])
`)
const ins = res.rows

console.debug(`found ${ins.length} of ${targetIds.length} (${ins.map(item => item.id).join(' ')})`)
if (!ins.length) {
    process.exit()
}

function fileStrId(date: Monday, fac: string) {
    return `${date.toString()}#${fac}`
}
// подготовить сет для поиска по strId
const insStrIdSet = new Set(ins.map(item => fileStrId(new Monday(item.date), item.fac_name)))

// получить инфу о всех файлах из future
const stIns = ins.reduce((pv, v) => ((pv.date.getTime() < v.date.getTime()) ? pv : v))
const remoteFiles = await Spider.fetchUpdates(new Monday(stIns.date))
// отфильтровать по strId
const targetFiles = remoteFiles.filter(item => insStrIdSet.has(fileStrId(item.date, item.faculty)))

console.debug(`matched ${targetFiles.length} of ${ins.length}`)

// обработка файлов
const textParser = await PairTextParser.makeParser();
for (const file of targetFiles) {
    try {
        console.debug(`processing ${fileStrId(file.date, file.faculty)}`)
        await Processor.process(file, textParser, true)
    } catch(e) {
        console.error(e)
    }
}

console.debug('exit')
process.exit(0)
