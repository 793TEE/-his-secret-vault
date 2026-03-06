const express = require('express');
const { getDb } = require('../database');

const router = express.Router();

// Submit credit score calculator lead
router.post('/credit-calculator', (req, res) => {
  try {
    const db = getDb();
    const { email, firstName, lastName, phone, paymentHistory, creditUtilization, creditAge, creditMix, newCredit } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Calculate estimated credit score
    // This is a simplified estimation algorithm
    let score = 300; // Base score

    // Payment history (35% weight)
    const paymentHistoryScores = { excellent: 245, good: 196, fair: 140, poor: 70 };
    score += paymentHistoryScores[paymentHistory] || 140;

    // Credit utilization (30% weight)
    const utilizationScores = { low: 210, moderate: 168, high: 105, very_high: 42 };
    score += utilizationScores[creditUtilization] || 105;

    // Credit age (15% weight)
    const ageScores = { long: 105, medium: 84, short: 52, new: 21 };
    score += ageScores[creditAge] || 52;

    // Credit mix (10% weight)
    const mixScores = { diverse: 70, moderate: 56, limited: 35 };
    score += mixScores[creditMix] || 35;

    // New credit inquiries (10% weight)
    const newCreditScores = { none: 70, few: 56, several: 35, many: 14 };
    score += newCreditScores[newCredit] || 35;

    // Cap the score
    score = Math.min(850, Math.max(300, score));

    // Save lead
    const result = db.prepare(`
      INSERT INTO leads (email, first_name, last_name, phone, source, credit_score_estimate, quiz_results)
      VALUES (?, ?, ?, ?, 'credit-calculator', ?, ?)
    `).run(
      email,
      firstName || null,
      lastName || null,
      phone || null,
      score,
      JSON.stringify({ paymentHistory, creditUtilization, creditAge, creditMix, newCredit })
    );

    // Determine credit tier
    let tier, message;
    if (score >= 750) {
      tier = 'Excellent';
      message = 'Your credit is in great shape! You may qualify for premium business funding options.';
    } else if (score >= 700) {
      tier = 'Good';
      message = 'Your credit is solid. With some optimization, you could unlock better rates.';
    } else if (score >= 650) {
      tier = 'Fair';
      message = 'There\'s room for improvement. Our credit repair services can help boost your score.';
    } else if (score >= 600) {
      tier = 'Poor';
      message = 'Your credit needs attention. We can help you rebuild and improve your score significantly.';
    } else {
      tier = 'Very Poor';
      message = 'Don\'t worry - we specialize in helping clients rebuild from any starting point.';
    }

    res.json({
      message: 'Score calculated successfully',
      leadId: result.lastInsertRowid,
      estimatedScore: score,
      tier,
      recommendation: message
    });
  } catch (error) {
    console.error('Credit calculator error:', error);
    res.status(500).json({ error: 'Failed to calculate score' });
  }
});

// Submit business name checker lead
router.post('/business-name', (req, res) => {
  try {
    const db = getDb();
    const { email, firstName, lastName, phone, businessName, state } = req.body;

    if (!email || !businessName) {
      return res.status(400).json({ error: 'Email and business name are required' });
    }

    // Simulate name availability check
    // In production, this would integrate with state business registries
    const commonWords = ['the', 'inc', 'llc', 'corp', 'company', 'services', 'solutions', 'group'];
    const nameLower = businessName.toLowerCase();
    const isGeneric = commonWords.some(word => nameLower.includes(word) && nameLower.split(' ').length < 3);

    // Random availability simulation (would be real API call in production)
    const random = Math.random();
    let available = random > 0.3; // 70% chance available for demo
    let similar = [];

    if (!available || isGeneric) {
      available = false;
      similar = [
        `${businessName} Group`,
        `${businessName} Solutions`,
        `${businessName} Services LLC`,
        `The ${businessName} Company`
      ];
    }

    // Save lead
    const result = db.prepare(`
      INSERT INTO leads (email, first_name, last_name, phone, source, business_name_checked, quiz_results)
      VALUES (?, ?, ?, ?, 'business-name-checker', ?, ?)
    `).run(
      email,
      firstName || null,
      lastName || null,
      phone || null,
      businessName,
      JSON.stringify({ businessName, state, available, similar })
    );

    res.json({
      message: 'Name check complete',
      leadId: result.lastInsertRowid,
      businessName,
      state: state || 'Not specified',
      available,
      suggestions: similar,
      recommendation: available
        ? 'Great news! This name appears to be available. Ready to register your business?'
        : 'This name may be taken or too similar to existing businesses. Consider our suggestions or let us help you find the perfect name.'
    });
  } catch (error) {
    console.error('Business name checker error:', error);
    res.status(500).json({ error: 'Failed to check business name' });
  }
});

// Submit funding eligibility quiz lead
router.post('/funding-quiz', (req, res) => {
  try {
    const db = getDb();
    const {
      email, firstName, lastName, phone,
      businessAge, annualRevenue, creditScore,
      businessType, fundingAmount, fundingPurpose
    } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Calculate funding eligibility
    let eligibilityScore = 0;
    let maxFunding = 0;
    let recommendations = [];

    // Business age scoring
    const ageScores = { '0-6months': 10, '6-12months': 25, '1-2years': 40, '2-5years': 60, '5plus': 80 };
    eligibilityScore += ageScores[businessAge] || 20;

    // Revenue scoring
    const revenueScores = { 'under50k': 10, '50k-100k': 25, '100k-250k': 45, '250k-500k': 65, '500k-1m': 80, 'over1m': 100 };
    eligibilityScore += revenueScores[annualRevenue] || 20;

    // Credit score impact
    const creditScores = { 'excellent': 80, 'good': 60, 'fair': 40, 'poor': 20, 'unknown': 30 };
    eligibilityScore += creditScores[creditScore] || 30;

    // Normalize score to 100
    eligibilityScore = Math.round(eligibilityScore / 2.6);

    // Determine funding range and recommendations
    if (eligibilityScore >= 80) {
      maxFunding = 500000;
      recommendations = [
        'SBA Loans',
        'Business Lines of Credit',
        'Term Loans',
        'Equipment Financing'
      ];
    } else if (eligibilityScore >= 60) {
      maxFunding = 150000;
      recommendations = [
        'Business Lines of Credit',
        'Short-term Business Loans',
        'Revenue-based Financing'
      ];
    } else if (eligibilityScore >= 40) {
      maxFunding = 50000;
      recommendations = [
        'Microloans',
        'Business Credit Cards',
        'Invoice Financing'
      ];
    } else {
      maxFunding = 25000;
      recommendations = [
        'Secured Business Credit Cards',
        'Microloans',
        'Credit Building First'
      ];
    }

    // Save lead
    const result = db.prepare(`
      INSERT INTO leads (email, first_name, last_name, phone, source, funding_eligibility, quiz_results)
      VALUES (?, ?, ?, ?, 'funding-quiz', ?, ?)
    `).run(
      email,
      firstName || null,
      lastName || null,
      phone || null,
      JSON.stringify({ score: eligibilityScore, maxFunding }),
      JSON.stringify({ businessAge, annualRevenue, creditScore, businessType, fundingAmount, fundingPurpose })
    );

    res.json({
      message: 'Eligibility assessment complete',
      leadId: result.lastInsertRowid,
      eligibilityScore,
      tier: eligibilityScore >= 80 ? 'Excellent' : eligibilityScore >= 60 ? 'Good' : eligibilityScore >= 40 ? 'Fair' : 'Building',
      estimatedMaxFunding: maxFunding,
      recommendedProducts: recommendations,
      nextSteps: eligibilityScore >= 60
        ? 'You have strong funding potential! Schedule a consultation to explore your options.'
        : 'We can help improve your eligibility. Consider our credit repair and business building services.'
    });
  } catch (error) {
    console.error('Funding quiz error:', error);
    res.status(500).json({ error: 'Failed to process quiz' });
  }
});

// Contact form submission
router.post('/contact', (req, res) => {
  try {
    const db = getDb();
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required' });
    }

    const result = db.prepare(`
      INSERT INTO contacts (name, email, phone, subject, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, email, phone || null, subject || 'General Inquiry', message);

    res.json({
      message: 'Thank you for contacting us! We\'ll get back to you within 24 hours.',
      contactId: result.lastInsertRowid
    });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: 'Failed to submit contact form' });
  }
});

module.exports = router;
