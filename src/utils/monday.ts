type DateArgsArray = 
    []
    | [value: number | string | Date]
    | [year: number, monthIndex: number, day?: number, hours?: number, minutes?: number, seconds?: number, milliseconds?: number];

export class Monday{
    date: Date;

    constructor(...args: DateArgsArray){
        // @ts-ignore
        this.date = new Date(...args);
        this.date.setDate(this.date.getDate() - (this.date.getDay() + 6) % 7);
        this.date.setHours(0, -this.date.getTimezoneOffset(), 0, 0);
    }

    get monday(): Date{
        if(this.date.getDay() !== 1){
            this.date.setDate(this.date.getDate() - (this.date.getDay() + 6) % 7);
            this.date.setHours(0, 0, 0, 0);
        }

        return this.date;
    }

    toString(){
        // 2012-12-12

        // 2012 - 12 - 12
        // 4   +1 +2+1 +2 = 10

        return this.date.toISOString().slice(0, 10);
    }
}