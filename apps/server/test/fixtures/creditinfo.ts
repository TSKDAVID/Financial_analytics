// Synthetic, fully anonymised Creditinfo-style report (same layout as the real "ჩემი კრედიტინფო" PDF; all values invented).
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const FONT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'NotoSansGeorgian-Regular.ttf');

export interface FakeContract { id: string; org: string; type: string; subtype: string; status: string; currency: string; original: number; balance: number; payment: number; term: number; installments?: number; start: string; closed?: string; penalty?: number; schedule?: [string, number][] }
export function creditPdf(contracts: FakeContract[], opts: { score?: number; rating?: string } = {}): Promise<Uint8Array> {
  return new Promise((res) => {
    const d = new PDFDocument({ size: 'A4', margin: 20 }); const bufs: Buffer[] = [];
    d.on('data', (b) => bufs.push(b)); d.on('end', () => res(new Uint8Array(Buffer.concat(bufs))));
    d.font(FONT).fontSize(7);
    let y = 30;
    const row = (...cells: [number, string][]) => { if (y > 780) { d.addPage(); y = 30; } cells.forEach(([x, s]) => d.text(s, x, y, { lineBreak: false })); y += 13; };
    row([40, 'ჩემი კრედიტინფო'], [300, '01.10.2026 10:00']);
    row([40, 'სახელი'], [140, '- სატესტო მომხმარებელი']);
    row([40, 'პირადი ნომერი'], [140, '- 00000000000']);
    row([60, 'სქორინგი']); row([90, String(opts.score ?? 512)]); row([80, 'საკრედიტო ქულა']); row([250, opts.rating ?? 'C2']); row([230, 'საკრედიტო რეიტინგი']);
    row([400, '7.50%']);
    row([40, 'ქულაზე მოქმედი ფაქტორი'], [200, 'აღწერა']);
    row([40, 'NAC2'], [200, 'აქტიური სესხების დიდი რაოდენობა']);
    row([40, 'დამატებითი ინფორმაცია']);
    const active = contracts.filter((c) => !c.closed);
    row([40, 'მიმდინარე ოპერაციები'], [250, String(active.length)]);
    row([40, 'შეწყვეტილი ოპერაციები'], [250, String(contracts.length - active.length)]);
    row([40, 'მიმდინარე ჯამური ვალდებულება'], [250, `${active.reduce((s, c) => s + c.balance, 0).toFixed(2)} GEL`]);
    row([40, 'მიმდინარე ვადაგადაცილებული თანხა'], [250, '0.00 GEL']);
    row([40, 'ყოველთვიური რეგულარული'], [250, `${active.reduce((s, c) => s + c.payment, 0).toFixed(2)} GEL`]);
    row([40, 'ყველა კონტრაქტი']);
    for (const c of contracts) {
      row([40, `სესხის იდენტიფიკატორი : ${c.id}`]);
      row([50, 'ორგანიზაცია'], [200, c.org], [330, 'სუბიექტის'], [450, 'მთავარი მოვალე']);
      row([50, 'სესხის ტიპი'], [170, c.type], [330, 'როლი']);
      row([50, 'კონტრაქტის ქვეტიპი'], [200, c.subtype]);
      row([50, 'კონტრაქტის სტატუსი'], [200, c.status]);
      if (c.installments) row([50, 'თავდაპირველი გრაფიკის განსაზღვრული შენატანების'], [280, String(c.installments)]);
      row([50, 'სესხის საკონტრაქტო ვადა (თვეებში)'], [280, String(c.term)], [330, 'სესხის იდენტიფიკატორი'], [450, c.id]);
      row([50, 'ძირითადი თარიღები']);
      row([50, 'სესხის გაცემის თარიღი'], [240, c.start.split('-').reverse().join('.')]);
      row([50, 'სესხის ფაქტობრივი დახურვის თარიღი'], [240, c.closed ? c.closed.split('-').reverse().join('.') : '–']);
      row([50, 'რესტრუქტურიზაციის სტატუსი'], [240, 'არა']);
      row([50, 'კონტრაქტის მონაცემები']);
      row([50, 'სესხის ვალუტა'], [240, c.currency], [300, 'გაცემული სესხის მოცულობა'], [480, `${c.original.toFixed(2)} ${c.currency}`]);
      row([50, 'ნაშთი'], [220, `${c.balance.toFixed(2)} ${c.currency}`], [300, 'სესხის მიმდინარე გადასახდელი ძირითადი'], [480, `${c.balance.toFixed(2)}`]);
      row([50, 'სტანდარტული შენატანის ოდენობა'], [220, `${c.payment.toFixed(2)} ${c.currency}`], [300, 'თანხა'], [480, c.currency]);
      row([50, 'ვადაგადაცილებული თანხა'], [220, '0.00 GEL']);
      row([50, 'ჯარიმის თანხა'], [220, `${(c.penalty ?? 0).toFixed(2)} GEL`]);
      row([50, 'მაქსიმალური ვადაგადაცილებული დღეების რაოდენობა'], [260, '0']);
      if (c.schedule) {
        row([50, 'განხორციელებული გადახდების გრაფიკი']);
        row([40, 'თვე/წელი'], ...c.schedule.map(([m], i) => [120 + i * 70, m] as [number, string]));
        row([40, 'ნაშთი'], ...c.schedule.map(([, v], i) => [120 + i * 70, `${v.toFixed(2)} GEL`] as [number, string]));
      }
      y += 10;
    }
    row([40, 'ძიებები']);
    d.end();
  });
}
export const SAMPLE: FakeContract[] = [
  { id: 'AAAA1111BBBB2222CCCC', org: 'საქართველოს ბანკი', type: 'რეგულარული გადახდების კონტრაქტი', subtype: 'სამომხმარებლო', status: 'არსებული', currency: 'GEL', original: 3000, balance: 2800, payment: 105.65, term: 36, installments: 36, start: '2026-03-10', schedule: [['9/2026', 2800], ['8/2026', 2870]] },
  { id: 'DDDD3333EEEE4444FFFF', org: 'თიბისი ბანკი', type: 'საკრედიტო ბარათი და განახლებადი კრედიტი', subtype: 'საკრედიტო ბარათი', status: 'არსებული', currency: 'GEL', original: 1500, balance: 640.5, payment: 0, term: 60, start: '2025-06-01', penalty: 12.5 },
  { id: 'GGGG5555HHHH6666IIII', org: 'ლიბერთი ბანკი', type: 'რეგულარული გადახდების კონტრაქტი', subtype: 'სამომხმარებლო', status: 'შეწყვეტილი', currency: 'GEL', original: 500, balance: 0, payment: 0, term: 10, installments: 10, start: '2024-01-05', closed: '2024-11-05' },
];
