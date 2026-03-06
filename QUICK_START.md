# Quick Start - Rebuilt Admin System

## 1. Initialize the Database

```bash
npm run init-db
```

This creates the database with:
- 3 Subscription Plans (Basic, Pro, Plus)
- 4 Pre-Made Bundles
- 11 AI Modes
- 4 Done-For-You Services
- Admin account

## 2. Start the Server

```bash
npm start
```

Server runs on `http://localhost:3000`

## 3. Access Admin Portal

Navigate to: `http://localhost:3000/admin`

**Login Credentials:**
- Email: `admin@hissecretvault.net`
- Password: `admin123`

**IMPORTANT:** Change this password immediately in production!

## 4. Explore the Admin Dashboard

### Dashboard
View key metrics:
- Total Clients
- Active Subscriptions
- Monthly Recurring Revenue (MRR)
- DFY Revenue
- Subscription breakdown by plan/bundle

### Subscriptions Page
- View all active/cancelled subscriptions
- Filter by type (Plan/Bundle/Custom)
- Cancel subscriptions
- View accessible AI modes per user

### DFY Orders Page
- Manage done-for-you service orders
- Track progress through process steps
- Update order status
- View service details and features

### Plans & Bundles Page
- View/edit subscription plans
- View/edit pre-made bundles
- See custom bundle pricing
- View all 11 AI modes

### Clients Page
- Enhanced client view with subscription info
- See accessible AI modes
- View all DFY orders
- Track total revenue per client

### Leads & Contacts
- Unchanged functionality
- Lead capture from tools
- Contact form submissions

## 5. Test the System

### Create a Test User Subscription

Use the browser console or make API calls:

```javascript
// This would typically be done through Stripe webhook or user portal
// For testing, you can insert directly into database or build a simple form

fetch('/api/admin/clients', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_ADMIN_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    subscriptionType: 'plan',
    planId: 2 // Pro plan
  })
})
```

### Create a Test DFY Order

Same approach - typically done through user checkout flow.

## 6. Key Files to Know

### Backend
- `server/database.js` - Database schema and seed data
- `server/routes/admin.js` - Admin API endpoints
- `server/init-db.js` - Database initialization script

### Frontend
- `public/admin/dashboard.html` - Main dashboard
- `public/admin/subscriptions.html` - Subscription management
- `public/admin/dfy-orders.html` - DFY order management
- `public/admin/plans.html` - Plans & bundles management
- `public/admin/clients.html` - Enhanced client view
- `public/admin/js/admin.js` - Admin API helper

### Documentation
- `ADMIN_REBUILD_SUMMARY.md` - Complete system documentation
- `MIGRATION_GUIDE.md` - Migration from old system
- `QUICK_START.md` - This file

## 7. Business Model Summary

### Subscription Revenue
- **Basic Plan:** $14.99/mo × subscribers
- **Pro Plan:** $49.99/mo × subscribers
- **Plus Plan:** $79.99/mo × subscribers
- **Pre-Made Bundles:** $19-29/mo × subscribers
- **Custom Bundles:** $19-49/mo × subscribers

### One-Time Revenue
- **Business Formation:** $497 per order
- **Credit Repair:** $500 per order
- **Funding Solutions:** $697 per order
- **Credit Repair Pro B2B:** $997/mo per client

**Total MRR** = Sum of all active subscriptions
**Total Revenue** = MRR + One-Time DFY Services

## 8. Next Steps

1. **Change Admin Password** - Use settings page to update
2. **Test All Features** - Click through every page
3. **Review Documentation** - Read `ADMIN_REBUILD_SUMMARY.md`
4. **Plan User Portal** - Build customer-facing subscription management
5. **Integrate Stripe** - Connect payment processing
6. **Set Up Webhooks** - Handle subscription events
7. **Email Notifications** - Auto-send updates to customers

## Need Help?

Check the documentation files:
- System Overview: `ADMIN_REBUILD_SUMMARY.md`
- Migration Info: `MIGRATION_GUIDE.md`
- This Guide: `QUICK_START.md`

## Troubleshooting

**Can't login to admin?**
- Default: admin@hissecretvault.net / admin123
- Make sure you ran `npm run init-db`

**Dashboard shows all zeros?**
- Normal for fresh install
- Create test subscriptions to see stats populate

**Port 3000 already in use?**
- Stop existing server: `Ctrl+C`
- Or change port in `.env`: `PORT=3001`

**Database not found?**
- Run: `npm run init-db`
- Check: `data/hissecretvault.db` exists

## Success Criteria

You'll know the system is working when:
- [x] Can login to admin portal
- [x] Dashboard loads with stats
- [x] Can view all 3 subscription plans
- [x] Can view all 4 bundles
- [x] Can view all 11 AI modes
- [x] Can view all 4 DFY services
- [x] Navigation works between all pages
- [x] No console errors in browser

Enjoy your rebuilt admin system!
