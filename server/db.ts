import Database from 'better-sqlite3';
import path from 'path';
import type { BillRecord, MedicineRecord, PharmacySettings, SellingRule } from '../src/types.ts';

const dbPath = path.resolve(process.cwd(), 'pharmacy.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_name TEXT NOT NULL,
    generic_name TEXT NOT NULL,
    strength TEXT NOT NULL,
    dosage_form TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    pack_size INTEGER NOT NULL DEFAULT 10,
    pack_unit TEXT NOT NULL DEFAULT 'strip',
    unit_label TEXT NOT NULL DEFAULT 'tablet',
    reference_unit_price REAL NOT NULL,
    reference_pack_price REAL NOT NULL,
    custom_unit_price REAL,
    selling_rule TEXT NOT NULL DEFAULT 'individual',
    price_source TEXT NOT NULL DEFAULT 'MedEx Bangladesh',
    medex_url TEXT NOT NULL DEFAULT 'https://medex.com.bd/',
    last_verified_at TEXT NOT NULL,
    stock_qty INTEGER,
    reorder_level INTEGER,
    batch_number TEXT,
    expiry_date TEXT,
    supplier_name TEXT
  );

  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_phone TEXT NOT NULL DEFAULT '',
    doctor_name TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL DEFAULT 'Cash',
    subtotal REAL NOT NULL,
    discount_type TEXT NOT NULL DEFAULT 'fixed',
    discount_value REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    grand_total REAL NOT NULL,
    paid_amount REAL NOT NULL,
    due_amount REAL NOT NULL,
    change_amount REAL NOT NULL,
    purchase_mode TEXT NOT NULL DEFAULT 'direct',
    duration_days INTEGER,
    budget_amount REAL,
    items_json TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    prescription_image TEXT
  );

  CREATE TABLE IF NOT EXISTS pharmacy_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    pharmacy_name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    drug_license_no TEXT NOT NULL,
    default_strip_only INTEGER NOT NULL DEFAULT 0,
    default_paper_size TEXT NOT NULL DEFAULT '80mm',
    footer_note TEXT NOT NULL
  );
`);

// Safe migration if database existed before prescription_image column
try {
  db.exec('ALTER TABLE bills ADD COLUMN prescription_image TEXT');
} catch {
  // column already exists
}

// Fast lookup & deduplication indexes for 25,000+ MedEx brands
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_medicines_brand ON medicines (brand_name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_medicines_generic ON medicines (generic_name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_medicines_form ON medicines (dosage_form COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_medicines_url ON medicines (medex_url);
`);

interface SeedMedicine {
  brand: string;
  generic: string;
  strength: string;
  form: string;
  mfr: string;
  packSize: number;
  packUnit: string;
  unitLabel: string;
  unitPrice: number;
  packPrice: number;
  rule: SellingRule;
  medexSlug: string;
}

const VERIFIED_DATE = '2026-11-15';

const SEED_MEDICINES: SeedMedicine[] = [
  // Fever, Analgesic & NSAID
  { brand: 'Napa', generic: 'Paracetamol', strength: '500 mg', form: 'Tablet', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 1.20, packPrice: 12.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/13181/napa-500-mg-tablet' },
  { brand: 'Napa Extra', generic: 'Paracetamol + Caffeine', strength: '500 mg + 65 mg', form: 'Tablet', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 2.50, packPrice: 25.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/13183/napa-extra-500-mg-tablet' },
  { brand: 'Napa Extend', generic: 'Paracetamol', strength: '665 mg', form: 'Tablet', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 2.00, packPrice: 20.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/13182/napa-extend-665-mg-tablet' },
  { brand: 'Napa', generic: 'Paracetamol', strength: '120 mg/5 ml', form: 'Syrup', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 60, packUnit: 'bottle', unitLabel: 'bottle (60 ml)', unitPrice: 35.00, packPrice: 35.00, rule: 'bottle', medexSlug: 'https://medex.com.bd/brands/13184/napa-120-mg-syrup' },
  { brand: 'Ace', generic: 'Paracetamol', strength: '500 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 1.20, packPrice: 12.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/12872/ace-500-mg-tablet' },
  { brand: 'Ace Plus', generic: 'Paracetamol + Caffeine', strength: '500 mg + 65 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 2.50, packPrice: 25.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/12875/ace-plus-500-mg-tablet' },
  { brand: 'Tufnil', generic: 'Tolfenamic Acid', strength: '200 mg', form: 'Tablet', mfr: 'Eskayef Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 10.00, packPrice: 100.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/18641/tufnil-200-mg-tablet' },
  { brand: 'Naprox Plus', generic: 'Naproxen + Esomeprazole', strength: '500 mg + 20 mg', form: 'Tablet', mfr: 'Eskayef Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 14.00, packPrice: 140.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/14908/naprox-plus-500-mg-tablet' },
  { brand: 'Flexi', generic: 'Aceclofenac', strength: '100 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 4.50, packPrice: 45.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/6152/flexi-100-mg-tablet' },
  { brand: 'Rolac', generic: 'Ketorolac Tromethamine', strength: '10 mg', form: 'Tablet', mfr: 'Renata Limited', packSize: 14, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 12.00, packPrice: 168.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/16178/rolac-10-mg-tablet' },

  // Gastric / PPI / GI
  { brand: 'Seclo', generic: 'Omeprazole', strength: '20 mg', form: 'Capsule', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'capsule', unitPrice: 6.00, packPrice: 60.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/16779/seclo-20-mg-capsule' },
  { brand: 'Seclo', generic: 'Omeprazole', strength: '40 mg', form: 'Capsule', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'capsule', unitPrice: 9.00, packPrice: 90.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/16780/seclo-40-mg-capsule' },
  { brand: 'Losectil', generic: 'Omeprazole', strength: '20 mg', form: 'Capsule', mfr: 'Eskayef Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'capsule', unitPrice: 6.00, packPrice: 60.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/10801/losectil-20-mg-capsule' },
  { brand: 'Sergel', generic: 'Esomeprazole Magnesium', strength: '20 mg', form: 'Capsule', mfr: 'Healthcare Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'capsule', unitPrice: 7.00, packPrice: 70.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/17003/sergel-20-mg-capsule' },
  { brand: 'Sergel', generic: 'Esomeprazole Magnesium', strength: '40 mg', form: 'Capsule', mfr: 'Healthcare Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'capsule', unitPrice: 10.00, packPrice: 100.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/17004/sergel-40-mg-capsule' },
  { brand: 'Maxpro', generic: 'Esomeprazole', strength: '20 mg', form: 'Tablet', mfr: 'Renata Limited', packSize: 14, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 7.00, packPrice: 98.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/11290/maxpro-20-mg-tablet' },
  { brand: 'Maxpro', generic: 'Esomeprazole', strength: '40 mg', form: 'Tablet', mfr: 'Renata Limited', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 10.00, packPrice: 100.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/11291/maxpro-40-mg-tablet' },
  { brand: 'Pantonix', generic: 'Pantoprazole', strength: '20 mg', form: 'Tablet', mfr: 'Incepta Pharmaceuticals Ltd.', packSize: 14, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 7.00, packPrice: 98.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/13618/pantonix-20-mg-tablet' },
  { brand: 'Pantonix', generic: 'Pantoprazole', strength: '40 mg', form: 'Tablet', mfr: 'Incepta Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 10.00, packPrice: 100.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/13619/pantonix-40-mg-tablet' },
  { brand: 'Omidon', generic: 'Domperidone', strength: '10 mg', form: 'Tablet', mfr: 'Incepta Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 3.50, packPrice: 35.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/13311/omidon-10-mg-tablet' },
  { brand: 'Motigut', generic: 'Domperidone', strength: '10 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 3.50, packPrice: 35.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/12316/motigut-10-mg-tablet' },
  { brand: 'Gavisol', generic: 'Sodium Alginate + Sodium Bicarbonate + Calcium Carbonate', strength: '500 mg + 213 mg + 325 mg/10 ml', form: 'Suspension', mfr: 'Square Pharmaceuticals PLC', packSize: 200, packUnit: 'bottle', unitLabel: 'bottle (200 ml)', unitPrice: 260.00, packPrice: 260.00, rule: 'bottle', medexSlug: 'https://medex.com.bd/brands/22932/gavisol-oral-suspension' },
  { brand: 'Algin', generic: 'Tiemonium Methylsulphate', strength: '50 mg', form: 'Tablet', mfr: 'Renata Limited', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 9.00, packPrice: 90.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/780/algin-50-mg-tablet' },
  { brand: 'Orsaline-N', generic: 'Oral Rehydration Salt', strength: '10.25 gm', form: 'Powder', mfr: 'SMC Enterprise Ltd.', packSize: 1, packUnit: 'sachet', unitLabel: 'sachet', unitPrice: 6.00, packPrice: 6.00, rule: 'sachet', medexSlug: 'https://medex.com.bd/brands/13391/orsaline-n-powder' },

  // Respiratory & Allergy
  { brand: 'Monas', generic: 'Montelukast Sodium', strength: '10 mg', form: 'Tablet', mfr: 'The ACME Laboratories Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 17.50, packPrice: 175.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/12227/monas-10-mg-tablet' },
  { brand: 'Montair', generic: 'Montelukast Sodium', strength: '10 mg', form: 'Tablet', mfr: 'Incepta Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 17.50, packPrice: 175.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/12242/montair-10-mg-tablet' },
  { brand: 'Fexo', generic: 'Fexofenadine Hydrochloride', strength: '120 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 9.00, packPrice: 90.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/5754/fexo-120-mg-tablet' },
  { brand: 'Fexo', generic: 'Fexofenadine Hydrochloride', strength: '180 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 11.00, packPrice: 110.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/5755/fexo-180-mg-tablet' },
  { brand: 'Alatrol', generic: 'Cetirizine Dihydrochloride', strength: '10 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 3.00, packPrice: 30.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/615/alatrol-10-mg-tablet' },
  { brand: 'Deslor', generic: 'Desloratadine', strength: '5 mg', form: 'Tablet', mfr: 'Opsonin Pharma Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 4.50, packPrice: 45.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/4380/deslor-5-mg-tablet' },
  { brand: 'Adovas', generic: 'Herbal Cough Expectorant', strength: '100 ml', form: 'Syrup', mfr: 'Square Pharmaceuticals PLC', packSize: 100, packUnit: 'bottle', unitLabel: 'bottle (100 ml)', unitPrice: 85.00, packPrice: 85.00, rule: 'bottle', medexSlug: 'https://medex.com.bd/brands/22819/adovas-syrup' },
  { brand: 'Tushka', generic: 'Dextromethorphan + Phenylephrine + Triprolidine', strength: '100 ml', form: 'Syrup', mfr: 'Square Pharmaceuticals PLC', packSize: 100, packUnit: 'bottle', unitLabel: 'bottle (100 ml)', unitPrice: 90.00, packPrice: 90.00, rule: 'bottle', medexSlug: 'https://medex.com.bd/brands/18736/tushka-syrup' },
  { brand: 'Azmasol', generic: 'Salbutamol', strength: '100 mcg/puff', form: 'Inhaler', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 200, packUnit: 'inhaler', unitLabel: 'inhaler (200 puffs)', unitPrice: 250.00, packPrice: 250.00, rule: 'inhaler', medexSlug: 'https://medex.com.bd/brands/1836/azmasol-100-mcg-inhaler' },
  { brand: 'Bexitrol-F', generic: 'Salmeterol + Fluticasone', strength: '25 mcg + 250 mcg', form: 'Inhaler', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 120, packUnit: 'inhaler', unitLabel: 'inhaler (120 puffs)', unitPrice: 550.00, packPrice: 550.00, rule: 'inhaler', medexSlug: 'https://medex.com.bd/brands/2105/bexitrol-f-25-250-inhaler' },

  // Antibiotics
  { brand: 'Zimax', generic: 'Azithromycin', strength: '500 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 6, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 40.00, packPrice: 240.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/20278/zimax-500-mg-tablet' },
  { brand: 'Azithrocin', generic: 'Azithromycin', strength: '500 mg', form: 'Tablet', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 6, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 40.00, packPrice: 240.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/1825/azithrocin-500-mg-tablet' },
  { brand: 'Cef-3', generic: 'Cefixime Trihydrate', strength: '200 mg', form: 'Capsule', mfr: 'Square Pharmaceuticals PLC', packSize: 14, packUnit: 'strip', unitLabel: 'capsule', unitPrice: 35.00, packPrice: 490.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/2804/cef-3-200-mg-capsule' },
  { brand: 'Cef-3', generic: 'Cefixime Trihydrate', strength: '400 mg', form: 'Capsule', mfr: 'Square Pharmaceuticals PLC', packSize: 6, packUnit: 'strip', unitLabel: 'capsule', unitPrice: 55.00, packPrice: 330.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/2805/cef-3-400-mg-capsule' },
  { brand: 'Ciprocin', generic: 'Ciprofloxacin', strength: '500 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 15.00, packPrice: 150.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/3552/ciprocin-500-mg-tablet' },
  { brand: 'Moxaclav', generic: 'Amoxicillin + Clavulanic Acid', strength: '625 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 6, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 32.00, packPrice: 192.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/12377/moxaclav-625-mg-tablet' },
  { brand: 'Tycil', generic: 'Amoxicillin Trihydrate', strength: '500 mg', form: 'Capsule', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'capsule', unitPrice: 7.50, packPrice: 75.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/18763/tycil-500-mg-capsule' },
  { brand: 'Filmet', generic: 'Metronidazole', strength: '400 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 1.70, packPrice: 17.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/5867/filmet-400-mg-tablet' },
  { brand: 'Amodis', generic: 'Metronidazole', strength: '400 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 1.70, packPrice: 17.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/980/amodis-400-mg-tablet' },
  { brand: 'Triject', generic: 'Ceftriaxone', strength: '1 gm', form: 'Injection', mfr: 'Square Pharmaceuticals PLC', packSize: 1, packUnit: 'vial', unitLabel: 'vial', unitPrice: 190.00, packPrice: 190.00, rule: 'vial', medexSlug: 'https://medex.com.bd/brands/18508/triject-1-gm-iv-injection' },

  // Diabetes, Hypertension & Cardiac (Chronic 15/30/60-day prescriptions)
  { brand: 'Comet', generic: 'Metformin Hydrochloride', strength: '500 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 4.00, packPrice: 40.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/3900/comet-500-mg-tablet' },
  { brand: 'Comet XR', generic: 'Metformin Hydrochloride', strength: '500 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 6.00, packPrice: 60.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/3902/comet-xr-500-mg-tablet' },
  { brand: 'Comet', generic: 'Metformin Hydrochloride', strength: '850 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 6.00, packPrice: 60.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/3901/comet-850-mg-tablet' },
  { brand: 'Secrin', generic: 'Glimepiride', strength: '2 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 8.00, packPrice: 80.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/16791/secrin-2-mg-tablet' },
  { brand: 'Linaglip', generic: 'Linagliptin', strength: '5 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 18.00, packPrice: 180.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/10566/linaglip-5-mg-tablet' },
  { brand: 'Bizoran', generic: 'Amlodipine + Olmesartan', strength: '5 mg + 20 mg', form: 'Tablet', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 16.00, packPrice: 160.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/2214/bizoran-5-20-tablet' },
  { brand: 'Amdocal', generic: 'Amlodipine Besilate', strength: '5 mg', form: 'Tablet', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 5.00, packPrice: 50.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/908/amdocal-5-mg-tablet' },
  { brand: 'Osartil', generic: 'Losartan Potassium', strength: '50 mg', form: 'Tablet', mfr: 'Incepta Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 10.00, packPrice: 100.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/13405/osartil-50-mg-tablet' },
  { brand: 'Bisorol', generic: 'Bisoprolol Fumarate', strength: '2.5 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 6.00, packPrice: 60.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/2190/bisorol-2-5-mg-tablet' },
  { brand: 'Atova', generic: 'Atorvastatin Calcium', strength: '10 mg', form: 'Tablet', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 12.00, packPrice: 120.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/1614/atova-10-mg-tablet' },
  { brand: 'Atova', generic: 'Atorvastatin Calcium', strength: '20 mg', form: 'Tablet', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 20.00, packPrice: 200.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/1615/atova-20-mg-tablet' },
  { brand: 'Rosuva', generic: 'Rosuvastatin', strength: '10 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 22.00, packPrice: 220.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/16244/rosuva-10-mg-tablet' },
  { brand: 'Ecosprin', generic: 'Aspirin', strength: '75 mg', form: 'Tablet', mfr: 'The ACME Laboratories Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 0.80, packPrice: 8.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/4923/ecosprin-75-mg-tablet' },
  { brand: 'Clopid', generic: 'Clopidogrel Bisulfate', strength: '75 mg', form: 'Tablet', mfr: 'Drug International Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 12.00, packPrice: 120.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/3781/clopid-75-mg-tablet' },

  // Vitamins, Minerals & Supplements
  { brand: 'Neuro-B', generic: 'Vitamin B1 + B6 + B12', strength: '100 mg + 200 mg + 200 mcg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 10.00, packPrice: 100.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/12803/neuro-b-tablet' },
  { brand: 'Calbo-D', generic: 'Calcium + Vitamin D3', strength: '500 mg + 200 IU', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 15, packUnit: 'bottle', unitLabel: 'tablet', unitPrice: 7.00, packPrice: 105.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/2506/calbo-d-tablet' },
  { brand: 'Coralcal-D', generic: 'Calcium (Coral) + Vitamin D3', strength: '500 mg + 200 IU', form: 'Tablet', mfr: 'Radiant Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 15.00, packPrice: 150.00, rule: 'strip', medexSlug: 'https://medex.com.bd/brands/3964/coralcal-d-tablet' },
  { brand: 'Bextram Gold', generic: 'Multivitamin & Multimineral', strength: 'A-Z Formula', form: 'Tablet', mfr: 'Beximco Pharmaceuticals Ltd.', packSize: 15, packUnit: 'bottle', unitLabel: 'tablet', unitPrice: 12.00, packPrice: 180.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/2109/bextram-gold-tablet' },
  { brand: 'D-Rise', generic: 'Cholecalciferol (Vitamin D3)', strength: '20000 IU', form: 'Capsule', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'capsule', unitPrice: 35.00, packPrice: 350.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/4095/d-rise-20000-iu-capsule' },
  { brand: 'Ceevit', generic: 'Ascorbic Acid (Vitamin C)', strength: '250 mg', form: 'Tablet', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 1.90, packPrice: 19.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/2795/ceevit-250-mg-tablet' },
  { brand: 'Xinc', generic: 'Zinc Sulfate Monohydrate', strength: '20 mg', form: 'Tablet', mfr: 'Eskayef Pharmaceuticals Ltd.', packSize: 10, packUnit: 'strip', unitLabel: 'tablet', unitPrice: 3.00, packPrice: 30.00, rule: 'individual', medexSlug: 'https://medex.com.bd/brands/19843/xinc-20-mg-tablet' },

  // Eye Drops & Topicals
  { brand: 'Tearon', generic: 'Carboxymethylcellulose Sodium', strength: '0.5%', form: 'Eye Drops', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'bottle', unitLabel: 'bottle (10 ml)', unitPrice: 120.00, packPrice: 120.00, rule: 'bottle', medexSlug: 'https://medex.com.bd/brands/18015/tearon-eye-drops' },
  { brand: 'Cipro-A', generic: 'Ciprofloxacin', strength: '0.3%', form: 'Eye Drops', mfr: 'Aristopharma Ltd.', packSize: 5, packUnit: 'bottle', unitLabel: 'bottle (5 ml)', unitPrice: 50.00, packPrice: 50.00, rule: 'bottle', medexSlug: 'https://medex.com.bd/brands/3546/cipro-a-eye-drops' },
  { brand: 'Bactrocin', generic: 'Mupirocin', strength: '2%', form: 'Ointment', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'tube', unitLabel: 'tube (10 gm)', unitPrice: 130.00, packPrice: 130.00, rule: 'tube', medexSlug: 'https://medex.com.bd/brands/1882/bactrocin-2-ointment' },
  { brand: 'Pevisone', generic: 'Econazole + Triamcinolone', strength: '1% + 0.1%', form: 'Cream', mfr: 'Square Pharmaceuticals PLC', packSize: 10, packUnit: 'tube', unitLabel: 'tube (10 gm)', unitPrice: 65.00, packPrice: 65.00, rule: 'tube', medexSlug: 'https://medex.com.bd/brands/13845/pevisone-cream' },
];

// Seed medicines if table is empty
const countRow = db.prepare('SELECT COUNT(*) as cnt FROM medicines').get() as { cnt: number };
if (countRow.cnt === 0) {
  const insertMed = db.prepare(`
    INSERT INTO medicines (
      brand_name, generic_name, strength, dosage_form, manufacturer,
      pack_size, pack_unit, unit_label, reference_unit_price, reference_pack_price,
      custom_unit_price, selling_rule, price_source, medex_url, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'MedEx Bangladesh', ?, ?)
  `);
  const seedTx = db.transaction((items: SeedMedicine[]) => {
    for (const m of items) {
      insertMed.run(
        m.brand, m.generic, m.strength, m.form, m.mfr,
        m.packSize, m.packUnit, m.unitLabel, m.unitPrice, m.packPrice,
        m.rule, m.medexSlug, VERIFIED_DATE
      );
    }
  });
  seedTx(SEED_MEDICINES);
}

// Seed default pharmacy settings if missing
const settingsRow = db.prepare('SELECT id FROM pharmacy_settings WHERE id = 1').get();
if (!settingsRow) {
  db.prepare(`
    INSERT INTO pharmacy_settings (
      id, pharmacy_name, tagline, address, phone, drug_license_no,
      default_strip_only, default_paper_size, footer_note
    ) VALUES (
      1,
      'Shifa Model Pharmacy',
      'Authentic Medicine & Prescription Care',
      'House 14, Road 7, Dhanmondi, Dhaka-1205',
      '+880 1711-000842',
      'DGDA-DHK-2026-4419',
      0,
      '80mm',
      'Check medicines and expiry before leaving counter. Sold items are exchanged within 3 days with receipt.'
    )
  `).run();
}

function mapMedicineRow(r: Record<string, unknown>): MedicineRecord {
  return {
    id: Number(r.id),
    brandName: String(r.brand_name),
    genericName: String(r.generic_name),
    strength: String(r.strength),
    dosageForm: String(r.dosage_form),
    manufacturer: String(r.manufacturer),
    packSize: Number(r.pack_size),
    packUnit: String(r.pack_unit),
    unitLabel: String(r.unit_label),
    referenceUnitPrice: Number(r.reference_unit_price),
    referencePackPrice: Number(r.reference_pack_price),
    customUnitPrice: r.custom_unit_price !== null && r.custom_unit_price !== undefined ? Number(r.custom_unit_price) : null,
    sellingRule: String(r.selling_rule) as SellingRule,
    priceSource: String(r.price_source),
    medexUrl: String(r.medex_url),
    lastVerifiedAt: String(r.last_verified_at),
    stockQty: r.stock_qty !== null && r.stock_qty !== undefined ? Number(r.stock_qty) : null,
    reorderLevel: r.reorder_level !== null && r.reorder_level !== undefined ? Number(r.reorder_level) : null,
    batchNumber: r.batch_number ? String(r.batch_number) : null,
    expiryDate: r.expiry_date ? String(r.expiry_date) : null,
    supplierName: r.supplier_name ? String(r.supplier_name) : null,
  };
}

export interface MedexBrandCardInput {
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  manufacturer: string;
  packSize: number;
  packUnit: string;
  unitLabel: string;
  sellingRule: SellingRule;
  medexUrl: string;
}

export function upsertMedexBrandsBulk(items: MedexBrandCardInput[]): number {
  if (items.length === 0) return 0;

  const findByUrl = db.prepare('SELECT id FROM medicines WHERE medex_url = ? LIMIT 1');
  const findByComposite = db.prepare(
    'SELECT id FROM medicines WHERE brand_name = ? COLLATE NOCASE AND strength = ? COLLATE NOCASE AND dosage_form = ? COLLATE NOCASE LIMIT 1'
  );
  const insertStmt = db.prepare(`
    INSERT INTO medicines (
      brand_name, generic_name, strength, dosage_form, manufacturer,
      pack_size, pack_unit, unit_label, reference_unit_price, reference_pack_price,
      custom_unit_price, selling_rule, price_source, medex_url, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, 'MedEx Bangladesh (Fetch Price)', ?, '')
  `);
  const updateUrlStmt = db.prepare(
    "UPDATE medicines SET medex_url = ?, generic_name = CASE WHEN generic_name = '' THEN ? ELSE generic_name END, manufacturer = CASE WHEN manufacturer = '' THEN ? ELSE manufacturer END WHERE id = ?"
  );

  let inserted = 0;
  const tx = db.transaction((list: MedexBrandCardInput[]) => {
    for (const item of list) {
      const byUrl = findByUrl.get(item.medexUrl) as { id: number } | undefined;
      if (byUrl) continue;

      const byComp = findByComposite.get(
        item.brandName,
        item.strength,
        item.dosageForm
      ) as { id: number } | undefined;
      if (byComp) {
        updateUrlStmt.run(item.medexUrl, item.genericName, item.manufacturer, byComp.id);
        continue;
      }

      insertStmt.run(
        item.brandName,
        item.genericName,
        item.strength,
        item.dosageForm,
        item.manufacturer,
        item.packSize,
        item.packUnit,
        item.unitLabel,
        item.sellingRule,
        item.medexUrl
      );
      inserted++;
    }
  });

  tx(items);
  return inserted;
}

export function getMedicineStats(): {
  totalCatalog: number;
  verifiedPriceCount: number;
} {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) as totalCatalog,
        SUM(CASE WHEN reference_unit_price > 0 OR custom_unit_price IS NOT NULL THEN 1 ELSE 0 END) as verifiedPriceCount
       FROM medicines`
    )
    .get() as { totalCatalog: number; verifiedPriceCount: number };
  return {
    totalCatalog: Number(row.totalCatalog || 0),
    verifiedPriceCount: Number(row.verifiedPriceCount || 0),
  };
}

export function queryMedicinesFast(params: {
  q?: string;
  dosageForm?: string;
  strength?: string;
  generic?: string;
  limit?: number;
  offset?: number;
}): {
  medicines: MedicineRecord[];
  totalMatched: number;
} {
  const conditions: string[] = [];
  const bind: unknown[] = [];

  const q = (params.q || '').trim();
  const dosageForm = (params.dosageForm || '').trim();
  const strength = (params.strength || '').trim();
  const generic = (params.generic || '').trim();

  if (dosageForm && dosageForm.toLowerCase() !== 'all') {
    conditions.push('dosage_form LIKE ? COLLATE NOCASE');
    bind.push(`%${dosageForm}%`);
  }
  if (strength) {
    conditions.push("REPLACE(LOWER(strength), ' ', '') LIKE ?");
    bind.push(`%${strength.toLowerCase().replace(/\s+/g, '')}%`);
  }
  if (generic) {
    conditions.push('generic_name LIKE ? COLLATE NOCASE');
    bind.push(`%${generic}%`);
  }
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      conditions.push(
        '(brand_name LIKE ? COLLATE NOCASE OR generic_name LIKE ? COLLATE NOCASE OR strength LIKE ? COLLATE NOCASE OR manufacturer LIKE ? COLLATE NOCASE)'
      );
      const pattern = `%${tok}%`;
      bind.push(pattern, pattern, pattern, pattern);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const totalRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM medicines ${whereClause}`)
    .get(...bind) as { cnt: number };

  const limit = Math.min(200, Math.max(1, params.limit ?? 60));
  const offset = Math.max(0, params.offset ?? 0);

  let orderBy =
    'CASE WHEN reference_unit_price > 0 OR custom_unit_price IS NOT NULL THEN 0 ELSE 1 END ASC, brand_name ASC, strength ASC';
  const orderBind: unknown[] = [];

  if (q) {
    orderBy = `
      CASE
        WHEN LOWER(brand_name) = LOWER(?) THEN 0
        WHEN LOWER(brand_name) LIKE LOWER(?) THEN 1
        WHEN LOWER(generic_name) LIKE LOWER(?) THEN 2
        ELSE 3
      END ASC,
      CASE WHEN reference_unit_price > 0 OR custom_unit_price IS NOT NULL THEN 0 ELSE 1 END ASC,
      brand_name ASC
    `;
    orderBind.push(q, `${q}%`, `${q}%`);
  }

  const rows = db
    .prepare(
      `SELECT * FROM medicines ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    )
    .all(...bind, ...orderBind, limit, offset) as Record<string, unknown>[];

  return {
    medicines: rows.map(mapMedicineRow),
    totalMatched: Number(totalRow.cnt || 0),
  };
}

export function getAllMedicines(): MedicineRecord[] {
  const rows = db.prepare('SELECT * FROM medicines ORDER BY brand_name ASC, strength ASC').all() as Record<string, unknown>[];
  return rows.map(mapMedicineRow);
}

export function getMedicineById(id: number): MedicineRecord | null {
  const row = db.prepare('SELECT * FROM medicines WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapMedicineRow(row) : null;
}

export function createMedicine(input: Omit<MedicineRecord, 'id'>): MedicineRecord {
  const stmt = db.prepare(`
    INSERT INTO medicines (
      brand_name, generic_name, strength, dosage_form, manufacturer,
      pack_size, pack_unit, unit_label, reference_unit_price, reference_pack_price,
      custom_unit_price, selling_rule, price_source, medex_url, last_verified_at,
      stock_qty, reorder_level, batch_number, expiry_date, supplier_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    input.brandName,
    input.genericName,
    input.strength,
    input.dosageForm,
    input.manufacturer,
    input.packSize,
    input.packUnit,
    input.unitLabel,
    input.referenceUnitPrice,
    input.referencePackPrice,
    input.customUnitPrice,
    input.sellingRule,
    input.priceSource || 'Manual / Pharmacy Entry',
    input.medexUrl || 'https://medex.com.bd/',
    input.lastVerifiedAt || new Date().toISOString().slice(0, 10),
    input.stockQty,
    input.reorderLevel,
    input.batchNumber,
    input.expiryDate,
    input.supplierName
  );
  return getMedicineById(Number(info.lastInsertRowid))!;
}

export function updateMedicine(id: number, patch: Partial<MedicineRecord>): MedicineRecord | null {
  const existing = getMedicineById(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  db.prepare(`
    UPDATE medicines SET
      brand_name = ?,
      generic_name = ?,
      strength = ?,
      dosage_form = ?,
      manufacturer = ?,
      pack_size = ?,
      pack_unit = ?,
      unit_label = ?,
      reference_unit_price = ?,
      reference_pack_price = ?,
      custom_unit_price = ?,
      selling_rule = ?,
      price_source = ?,
      medex_url = ?,
      last_verified_at = ?,
      stock_qty = ?,
      reorder_level = ?,
      batch_number = ?,
      expiry_date = ?,
      supplier_name = ?
    WHERE id = ?
  `).run(
    merged.brandName,
    merged.genericName,
    merged.strength,
    merged.dosageForm,
    merged.manufacturer,
    merged.packSize,
    merged.packUnit,
    merged.unitLabel,
    merged.referenceUnitPrice,
    merged.referencePackPrice,
    merged.customUnitPrice,
    merged.sellingRule,
    merged.priceSource,
    merged.medexUrl,
    merged.lastVerifiedAt,
    merged.stockQty,
    merged.reorderLevel,
    merged.batchNumber,
    merged.expiryDate,
    merged.supplierName,
    id
  );
  return getMedicineById(id);
}

function mapBillRow(r: Record<string, unknown>): BillRecord {
  return {
    id: Number(r.id),
    invoiceNumber: String(r.invoice_number),
    createdAt: String(r.created_at),
    customerName: String(r.customer_name),
    customerPhone: String(r.customer_phone),
    doctorName: String(r.doctor_name),
    paymentMethod: String(r.payment_method) as BillRecord['paymentMethod'],
    subtotal: Number(r.subtotal),
    discountType: String(r.discount_type) as 'fixed' | 'percent',
    discountValue: Number(r.discount_value),
    discountAmount: Number(r.discount_amount),
    grandTotal: Number(r.grand_total),
    paidAmount: Number(r.paid_amount),
    dueAmount: Number(r.due_amount),
    changeAmount: Number(r.change_amount),
    purchaseMode: String(r.purchase_mode) as BillRecord['purchaseMode'],
    durationDays: r.duration_days !== null ? Number(r.duration_days) : null,
    budgetAmount: r.budget_amount !== null ? Number(r.budget_amount) : null,
    items: JSON.parse(String(r.items_json)),
    notes: String(r.notes),
    prescriptionImage: r.prescription_image ? String(r.prescription_image) : null,
  };
}

export function listBills(limit = 50): BillRecord[] {
  const rows = db.prepare('SELECT * FROM bills ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(mapBillRow);
}

export function getBillById(id: number): BillRecord | null {
  const row = db.prepare('SELECT * FROM bills WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapBillRow(row) : null;
}

export function createBill(payload: Omit<BillRecord, 'id' | 'invoiceNumber' | 'createdAt'>): BillRecord {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const countToday = (
    db.prepare("SELECT COUNT(*) as cnt FROM bills WHERE invoice_number LIKE ?").get(`INV-${datePart}-%`) as { cnt: number }
  ).cnt;
  const seq = String(countToday + 1).padStart(4, '0');
  const invoiceNumber = `INV-${datePart}-${seq}`;
  const createdAt = now.toISOString();

  const info = db.prepare(`
    INSERT INTO bills (
      invoice_number, created_at, customer_name, customer_phone, doctor_name,
      payment_method, subtotal, discount_type, discount_value, discount_amount,
      grand_total, paid_amount, due_amount, change_amount, purchase_mode,
      duration_days, budget_amount, items_json, notes, prescription_image
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    invoiceNumber,
    createdAt,
    payload.customerName || '',
    payload.customerPhone || '',
    payload.doctorName || '',
    payload.paymentMethod || 'Cash',
    payload.subtotal,
    payload.discountType,
    payload.discountValue,
    payload.discountAmount,
    payload.grandTotal,
    payload.paidAmount,
    payload.dueAmount,
    payload.changeAmount,
    payload.purchaseMode || 'direct',
    payload.durationDays ?? null,
    payload.budgetAmount ?? null,
    JSON.stringify(payload.items),
    payload.notes || '',
    payload.prescriptionImage ?? null
  );

  return getBillById(Number(info.lastInsertRowid))!;
}

export function getDashboardSummary() {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayStats = db.prepare(`
    SELECT
      COUNT(*) as billCount,
      COALESCE(SUM(grand_total), 0) as totalSales,
      COALESCE(SUM(paid_amount - change_amount), 0) as totalCollected,
      COALESCE(SUM(due_amount), 0) as totalDue
    FROM bills
    WHERE created_at LIKE ?
  `).get(`${todayPrefix}%`) as {
    billCount: number;
    totalSales: number;
    totalCollected: number;
    totalDue: number;
  };

  const totalMedicines = (db.prepare('SELECT COUNT(*) as cnt FROM medicines').get() as { cnt: number }).cnt;
  const recentBills = listBills(8);
  return {
    todayBillCount: todayStats.billCount,
    todaySales: Number(todayStats.totalSales.toFixed(2)),
    todayCollected: Number(todayStats.totalCollected.toFixed(2)),
    todayDue: Number(todayStats.totalDue.toFixed(2)),
    totalMedicines,
    recentBills,
  };
}

export function getSettings(): PharmacySettings {
  const row = db.prepare('SELECT * FROM pharmacy_settings WHERE id = 1').get() as Record<string, unknown>;
  return {
    pharmacyName: String(row.pharmacy_name),
    tagline: String(row.tagline),
    address: String(row.address),
    phone: String(row.phone),
    drugLicenseNo: String(row.drug_license_no),
    defaultStripOnly: Boolean(row.default_strip_only),
    defaultPaperSize: String(row.default_paper_size) as PharmacySettings['defaultPaperSize'],
    footerNote: String(row.footer_note),
  };
}

export function updateSettings(patch: Partial<PharmacySettings>): PharmacySettings {
  const current = getSettings();
  const merged = { ...current, ...patch };
  db.prepare(`
    UPDATE pharmacy_settings SET
      pharmacy_name = ?,
      tagline = ?,
      address = ?,
      phone = ?,
      drug_license_no = ?,
      default_strip_only = ?,
      default_paper_size = ?,
      footer_note = ?
    WHERE id = 1
  `).run(
    merged.pharmacyName,
    merged.tagline,
    merged.address,
    merged.phone,
    merged.drugLicenseNo,
    merged.defaultStripOnly ? 1 : 0,
    merged.defaultPaperSize,
    merged.footerNote
  );
  return getSettings();
}
