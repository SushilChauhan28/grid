// Generates the Mockaroo-equivalent dataset used by the "All Features" section.
// Deterministic (seeded) so the fixture is reproducible across machines.
//   node tools/generate-dataset.mjs [count] [outFile]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const COUNT = Number(process.argv[2] ?? 10000);
const OUT = resolve(process.argv[3] ?? 'public/data/entities-10k.json');

// mulberry32 — small, fast, seedable.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260831);
const pick = (a) => a[Math.floor(rand() * a.length)];
/** Picks from [value, weight] pairs so status/priority mixes look realistic. */
const weighted = (pairs) => {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rand() * total;
  for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; }
  return pairs[pairs.length - 1][0];
};
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pad = (n, w) => String(n).padStart(w, '0');

const PREFIX = ['Affordable', 'Allegheny', 'Apex', 'Ashford', 'Beacon', 'Bradford', 'Cedar', 'Crestview', 'Delaware', 'Drexel', 'Eastgate', 'Evergreen', 'Fairfield', 'Frontier', 'Gateway', 'Harbor', 'Ironclad', 'Junction', 'Keystone', 'Lakeside', 'Meridian', 'Northgate', 'Oakwood', 'Pinnacle', 'Quantum', 'Riverside', 'Summit', 'Titan', 'Union', 'Valley Forge', 'Westbrook', 'Yellowstone', 'Zenith'];
const MIDDLE = ['Aluminum', 'Freight', 'Logistics', 'Manufacturing', 'Equipment', 'Holdings', 'Trading', 'Materials', 'Supply', 'Fabrication', 'Industrial', 'Capital', 'Trust', 'Ventures', 'Storage', 'Auto', 'Truck Sales', 'Wheel Repair', 'Food Cart Rentals', 'Trailers'];
const SUFFIX = ['Inc.', 'LLC', 'Co.', 'Partners', 'Group', 'Corp.', 'Holdings LLC', 'Enterprises'];
const STREETS = ['Main St', 'Starkey Rd', 'Industrial Pkwy', 'Gardiner Ln', '50th Street', 'Windy City Rd', 'Commerce Dr', 'Harbor Blvd', 'Lakeview Ave', 'Foundry Way'];
const PLACES = [['Wilmington', 'DE', '19808'], ['Largo', 'FL', '33770'], ['Mulino', 'OR', '97042'], ['Lubbock', 'TX', '79404'], ['Louisville', 'KY', '40213'], ['Pittsburgh', 'PA', '15201'], ['Norcross', 'GA', '30071'], ['Marlboro', 'MA', '01752'], ['St. Louis', 'MO', '63102'], ['Dover', 'DE', '19901'], ['Austin', 'TX', '78701'], ['Reno', 'NV', '89501'], ['Boise', 'ID', '83702'], ['Tacoma', 'WA', '98402'], ['Akron', 'OH', '44301'], ['Phoenix', 'AZ', '85004'], ['Denver', 'CO', '80202'], ['Raleigh', 'NC', '27601'], ['Madison', 'WI', '53703'], ['Trenton', 'NJ', '08608']];
const COUNTRIES = [['United States (USA)', 90], ['Canada (CAN)', 6], ['Mexico (MEX)', 4]];
const STATUSES = [['Active', 40], ['In Good Standing', 25], ['Pending', 15], ['Under Review', 12], ['Dissolved', 5], ['Suspended', 3]];
const PRIORITIES = [['Critical', 8], ['High', 22], ['Medium', 45], ['Low', 25]];
const AGENTS = ['CSC - Lawyers Incorporating', 'C T Corporation System', 'Registered Agents Inc.', 'National Registered Agents', 'Corporation Service Company'];
const JURIS = [['Delaware', 35], ['Texas', 15], ['Nevada', 12], ['California', 10], ['New York', 10], ['Florida', 8], ['Oregon', 5], ['Wyoming', 5]];
const FIRST = ['James', 'Maria', 'Robert', 'Linda', 'David', 'Susan', 'Michael', 'Karen', 'Daniel', 'Nancy', 'Priya', 'Wei', 'Omar', 'Sofia', 'Hannah', 'Marcus', 'Elena', 'Tomas', 'Aisha', 'Victor'];
const LAST = ['Anderson', 'Reyes', 'Whitfield', 'Okafor', 'Nakamura', 'Delgado', 'Brennan', 'Kaur', 'Lindqvist', 'Moreau', 'Castellanos', 'Ferraro', 'Novak', 'Haddad', 'Sorensen', 'Muller', 'Petrov', 'Silva', 'Chen', 'Bianchi'];

const mdy = (d) => `${pad(d.getMonth() + 1, 2)}/${pad(d.getDate(), 2)}/${d.getFullYear()}`;
const mdyTime = (d) => {
  const h = d.getHours(), h12 = h % 12 || 12;
  return `${mdy(d)} ${pad(h12, 2)}:${pad(d.getMinutes(), 2)} ${h < 12 ? 'AM' : 'PM'}`;
};

const rows = Array.from({ length: COUNT }, (_, i) => {
  const [city, state, zip] = pick(PLACES);
  const first = pick(FIRST), last = pick(LAST);
  const filed = new Date(2020, 0, 1);
  filed.setDate(filed.getDate() + int(0, 2190));
  const touched = new Date(2024, 0, 1);
  touched.setMinutes(touched.getMinutes() + int(0, 1_200_000));
  return {
    id: 'D' + pad(100000 + i, 7),
    doc: String(1000000 + i * 7 + int(0, 6)),
    entity: `${pick(PREFIX)} ${pick(MIDDLE)} ${pick(SUFFIX)}`,
    address: `${int(100, 9800)} ${pick(STREETS)}, Suite ${int(100, 899)}`,
    city, state, zip: zip + '-' + pad(int(0, 9999), 4),
    country: weighted(COUNTRIES),
    date: mdy(filed),
    status: weighted(STATUSES),
    priority: weighted(PRIORITIES),
    owner: `${first} ${last}`,
    ownerEmail: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@cscglobal.com',
    updated: mdyTime(touched),
    agent: pick(AGENTS),
    jurisdiction: weighted(JURIS),
    revenue: int(50_000, 95_000_000),
    childCount: int(0, 12),
  };
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rows));
console.log(`Wrote ${rows.length} records to ${OUT}`);
