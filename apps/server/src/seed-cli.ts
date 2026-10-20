import { openDb } from './db';
import { seedDemo } from './seed';
import { evaluateAlerts } from './alerts';
const db = openDb();
await seedDemo(db);
await evaluateAlerts(db);
console.log('Demo data loaded.');
