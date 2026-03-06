# Migration Guide - Old to New Admin System

## Overview

This guide helps you migrate from the old service-based system to the new subscription-based system.

---

## Before Migration

### Backup Current Database
```bash
# Make a copy of your current database
cp data/hissecretvault.db data/hissecretvault.db.backup
```

---

## Migration Options

### Option 1: Fresh Start (Recommended for Testing)

This creates a completely new database with the new structure and seed data.

```bash
# Remove old database
rm data/hissecretvault.db

# Initialize new database
npm run init-db

# Start server
npm start
```

**Result:** Fresh database with:
- 3 subscription plans seeded
- 4 pre-made bundles seeded
- 11 AI modes seeded
- 4 DFY services seeded
- Admin account: admin@hissecretvault.net / admin123

---

### Option 2: Preserve Existing Data

If you have existing users, leads, or contacts you want to keep, follow these steps:

#### Step 1: Export Current Data

Create a script to export important data:

```javascript
// scripts/export-data.js
const { initSqlJsDatabase, getDb } = require('./server/database');

async function exportData() {
  await initSqlJsDatabase();
  const db = getDb();

  // Export users
  const users = db.prepare('SELECT * FROM users').all();
  console.log('Users:', JSON.stringify(users, null, 2));

  // Export leads
  const leads = db.prepare('SELECT * FROM leads').all();
  console.log('Leads:', JSON.stringify(leads, null, 2));

  // Export contacts
  const contacts = db.prepare('SELECT * FROM contacts').all();
  console.log('Contacts:', JSON.stringify(contacts, null, 2));

  // Export old orders (for reference)
  const orders = db.prepare('SELECT * FROM orders').all();
  console.log('Orders:', JSON.stringify(orders, null, 2));
}

exportData();
```

Save output to files:
```bash
node scripts/export-data.js > data/export.json
```

#### Step 2: Initialize New Database

```bash
npm run init-db
```

#### Step 3: Import Preserved Data

Create an import script:

```javascript
// scripts/import-data.js
const { initSqlJsDatabase, getDb } = require('./server/database');
const fs = require('fs');

async function importData() {
  await initSqlJsDatabase();
  const db = getDb();

  const exported = JSON.parse(fs.readFileSync('data/export.json', 'utf8'));

  // Re-insert users
  const insertUser = db.prepare(`
    INSERT INTO users (email, password, first_name, last_name, phone, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  exported.users.forEach(user => {
    try {
      insertUser.run(
        user.email,
        user.password,
        user.first_name,
        user.last_name,
        user.phone,
        user.created_at,
        user.status
      );
    } catch (e) {
      console.log('Skipping duplicate user:', user.email);
    }
  });

  // Re-insert leads
  const insertLead = db.prepare(`
    INSERT INTO leads (email, first_name, last_name, phone, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  exported.leads.forEach(lead => {
    insertLead.run(
      lead.email,
      lead.first_name,
      lead.last_name,
      lead.phone,
      lead.source,
      lead.created_at
    );
  });

  // Re-insert contacts
  const insertContact = db.prepare(`
    INSERT INTO contacts (name, email, phone, subject, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  exported.contacts.forEach(contact => {
    insertContact.run(
      contact.name,
      contact.email,
      contact.phone,
      contact.subject,
      contact.message,
      contact.status,
      contact.created_at
    );
  });

  db.save();
  console.log('Data imported successfully!');
}

importData();
```

Run the import:
```bash
node scripts/import-data.js
```

---

### Option 3: Keep Both Systems Running

You can run both the old and new systems side-by-side for a transition period:

1. **Rename old database:**
```bash
mv data/hissecretvault.db data/hissecretvault-old.db
```

2. **Initialize new database:**
```bash
npm run init-db
```

3. **Switch between them by changing `.env`:**
```env
# Use new database
DATABASE_PATH=./data/hissecretvault.db

# Or use old database
DATABASE_PATH=./data/hissecretvault-old.db
```

---

## Mapping Old to New System

### Old Orders → New System

**One-Time Services → DFY Orders**
- Old "LLC Formation" order → New DFY "Business Formation"
- Old "Credit Repair" order → New DFY "Automated Credit Repair"
- Old "Funding" order → New DFY "Funding Solutions"

**Recurring Services → Subscriptions**
- Old monthly credit repair → New subscription to Credit Mastery AI mode
- Old consulting retainer → New Plus plan subscription

---

## Converting Existing Customers

If you have paying customers in the old system:

### 1. Identify Active Customers
```sql
SELECT u.*, o.* FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.payment_status = 'paid'
  AND o.status = 'active';
```

### 2. Create Subscriptions for Them

Manually create subscriptions in the new system:

```sql
-- Give them a Pro plan subscription
INSERT INTO user_subscriptions (
  user_id,
  subscription_type,
  plan_id,
  status,
  current_period_start,
  current_period_end
) VALUES (
  1, -- user ID
  'plan',
  2, -- Pro plan
  'active',
  CURRENT_TIMESTAMP,
  date('now', '+30 days')
);
```

### 3. Notify Customers

Send emails to existing customers about the new system:
- Explain the transition to subscription model
- Show them what AI modes they now have access to
- Provide login credentials for new portal
- Offer migration assistance

---

## Post-Migration Checklist

- [ ] Verify all users were migrated
- [ ] Verify all leads were preserved
- [ ] Verify all contacts were preserved
- [ ] Test admin login
- [ ] Test dashboard loads correctly
- [ ] Test subscription creation
- [ ] Test DFY order creation
- [ ] Test client detail view
- [ ] Verify MRR calculation is correct
- [ ] Update any documentation
- [ ] Train staff on new admin interface

---

## Rollback Plan

If something goes wrong, you can quickly rollback:

```bash
# Stop the server
# Restore backup
cp data/hissecretvault.db.backup data/hissecretvault.db

# Restart server
npm start
```

---

## Common Issues

### Issue: "Admin login not working"
**Solution:** The default admin account is:
- Email: `admin@hissecretvault.net`
- Password: `admin123`

Change this immediately in production!

### Issue: "No subscriptions showing up"
**Solution:** Subscriptions must be manually created for users. There's no automatic migration from old orders to subscriptions. You'll need to create them via:
1. Admin panel (when user portal is built)
2. Direct database insert
3. Stripe webhook (when integrated)

### Issue: "Old orders not showing"
**Solution:** Old orders are still in the `orders` table. They're kept for reference but not shown in the main DFY Orders page (which uses `dfy_orders` table). You can still query them directly or build a separate "Legacy Orders" page if needed.

### Issue: "MRR shows $0"
**Solution:** MRR is calculated from `user_subscriptions` table. If you have no active subscriptions yet, MRR will be $0. Create some test subscriptions to see it populate.

---

## Need Help?

If you encounter issues during migration:

1. Check `ADMIN_REBUILD_SUMMARY.md` for system documentation
2. Review database schema in `server/database.js`
3. Check API routes in `server/routes/admin.js`
4. Verify seed data was created: `SELECT COUNT(*) FROM subscription_plans;` should return 3

---

## Timeline Recommendation

**Week 1:** Test new system in development
- Run fresh install
- Explore all admin pages
- Create test subscriptions and DFY orders
- Verify all features work

**Week 2:** Plan data migration
- Export current customer data
- Map old services to new offerings
- Draft customer communication emails

**Week 3:** Execute migration in staging
- Create staging environment
- Run migration scripts
- Test thoroughly

**Week 4:** Production migration
- Schedule maintenance window
- Backup everything
- Execute migration
- Notify customers
- Monitor closely

---

## Support Files Created

- `ADMIN_REBUILD_SUMMARY.md` - Complete documentation of new system
- `MIGRATION_GUIDE.md` - This file
- `server/init-db.js` - Database initialization script
