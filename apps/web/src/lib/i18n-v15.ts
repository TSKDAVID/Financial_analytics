/** Strings for merchant analytics, month drill-down, people ranking and the analytics fix notice. */
export const EN_15: Record<string, string> = {
  'nav.merchants': 'Merchants', 'mer.title': 'Merchants', 'mer.subtitle': 'Where your money goes, shop by shop. Names are cleaned up and grouped (e.g. “FLT*Jetshr” → Jetshr). Transfers to people, own transfers, cash and fees are not included.',
  'mer.total': 'Spent at merchants', 'mer.count': 'Payments', 'mer.avg': 'Avg. payment', 'mer.thisMonth': 'This month', 'mer.lastMonth': 'Last month', 'mer.usual': 'Usual / month', 'mer.trend': 'Monthly trend', 'mer.months': 'Months', 'mer.search': 'Search merchant…', 'mer.share': 'share',
  'ins.mTop': 'Your biggest merchant is {merchant}: {amount} ₾ ({pct}% of merchant spending) in {count} payments.',
  'ins.mHabit': 'Habit: {count} payments at {merchant}, about {avg} ₾ each — roughly {monthly} ₾ a month.',
  'ins.mUp': '{merchant}: {amount} ₾ this month, {pct}% more than your usual {usual} ₾.',
  'ins.mSmall': '{count} small payments (under 10 ₾ each) added up to {amount} ₾ — mostly {names}.',
  'month.title': '{month} overview', 'month.byCategory': 'Expenses by category', 'month.topMerchants': 'Top merchants', 'month.incomeBy': 'Income', 'month.moved': 'Moved between your own accounts (not counted): {amount}', 'month.hint': 'Click a month in the chart to see its details.',
  'ppl.sort': 'Sort by', 'ppl.sort.sent': 'Sent most', 'ppl.sort.received': 'Received most', 'ppl.sort.total': 'Total', 'ppl.sort.net': 'Balance', 'ppl.sent': 'Sent', 'ppl.received': 'Received',
  'fix.title': 'Analytics corrected', 'fix.body': 'Transfers between your own BOG/TBC accounts ({pairs} pairs) were counted as both spending and income, and money that went to people and came back counted as P&L. That is fixed: income {bi} → {ai} ₾, expenses {be} → {ae} ₾ (all history). Everything is reversible from Import.', 'fix.ok': 'Got it',
  'acc.openingDate': 'Balance as of', 'acc.openingDateHint': 'Only transactions after this date change the balance.',
  'imp.autoConfirmNote': 'Approving also confirms suggested own-account transfers with ≥ 90% match.',
};
export const KA_15: Record<string, string> = {
  'nav.merchants': 'მერჩანტები', 'mer.title': 'მერჩანტები', 'mer.subtitle': 'სად მიდის ფული — მაღაზიების მიხედვით. სახელები გასუფთავებული და დაჯგუფებულია (მაგ. „FLT*Jetshr“ → Jetshr). ადამიანებზე გადარიცხვები, საკუთარ ანგარიშებს შორის, ნაღდი და საკომისიო არ ითვლება.',
  'mer.total': 'მერჩანტებთან დახარჯული', 'mer.count': 'გადახდები', 'mer.avg': 'საშ. გადახდა', 'mer.thisMonth': 'ამ თვეში', 'mer.lastMonth': 'გასულ თვეში', 'mer.usual': 'ჩვეულებრივ / თვე', 'mer.trend': 'თვიური ტრენდი', 'mer.months': 'თვე', 'mer.search': 'ძებნა…', 'mer.share': 'წილი',
  'ins.mTop': 'ყველაზე დიდი მერჩანტი: {merchant} — {amount} ₾ (მერჩანტების ხარჯის {pct}%), {count} გადახდა.',
  'ins.mHabit': 'ჩვევა: {count} გადახდა {merchant}-ში, საშუალოდ {avg} ₾ — დაახლ. {monthly} ₾ თვეში.',
  'ins.mUp': '{merchant}: ამ თვეში {amount} ₾, ჩვეულებრივზე ({usual} ₾) {pct}%-ით მეტი.',
  'ins.mSmall': '{count} მცირე გადახდა (თითო 10 ₾-მდე) ჯამში {amount} ₾ — ძირითადად {names}.',
  'month.title': '{month} — მიმოხილვა', 'month.byCategory': 'ხარჯი კატეგორიებით', 'month.topMerchants': 'ტოპ მერჩანტები', 'month.incomeBy': 'შემოსავალი', 'month.moved': 'საკუთარ ანგარიშებს შორის (არ ითვლება): {amount}', 'month.hint': 'დააჭირეთ თვეს გრაფიკზე დეტალებისთვის.',
  'ppl.sort': 'დალაგება', 'ppl.sort.sent': 'ყველაზე მეტი გაგზავნილი', 'ppl.sort.received': 'ყველაზე მეტი მიღებული', 'ppl.sort.total': 'ჯამი', 'ppl.sort.net': 'ბალანსი', 'ppl.sent': 'გაგზავნილი', 'ppl.received': 'მიღებული',
  'fix.title': 'ანალიტიკა გასწორდა', 'fix.body': 'BOG/TBC საკუთარ ანგარიშებს შორის გადარიცხვები ({pairs} წყვილი) ითვლებოდა ხარჯადაც და შემოსავლადაც, ადამიანებთან გაგზავნილ-დაბრუნებული თანხაც. გასწორდა: შემოსავალი {bi} → {ai} ₾, ხარჯი {be} → {ae} ₾ (მთელი ისტორია). ყველაფერი შექცევადია Import-იდან.', 'fix.ok': 'გასაგებია',
  'acc.openingDate': 'ბალანსი თარიღისთვის', 'acc.openingDateHint': 'ბალანსს ცვლის მხოლოდ ამ თარიღის შემდეგი ტრანზაქციები.',
  'imp.autoConfirmNote': 'დამტკიცება ასევე ადასტურებს ≥ 90% დამთხვევის საკუთარ გადარიცხვებს.',
};
