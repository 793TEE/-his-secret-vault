// His Secret Vault - Main Application JavaScript

const App = {
  apiUrl: '/api',
  token: localStorage.getItem('hsv_token'),
  user: null,

  // Initialize application
  async init() {
    this.setupNavigation();
    this.setupScrollEffects();
    this.setupChatWidget();
    await this.checkAuth();
    this.setupForms();
  },

  // API Helper
  async api(endpoint, options = {}) {
    const url = `${this.apiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  },

  // Check authentication
  async checkAuth() {
    if (!this.token) return false;

    try {
      this.user = await this.api('/auth/me');
      this.updateAuthUI();
      return true;
    } catch (error) {
      this.logout();
      return false;
    }
  },

  // Login
  async login(email, password) {
    const data = await this.api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    this.token = data.token;
    this.user = data.user;
    localStorage.setItem('hsv_token', data.token);
    this.updateAuthUI();

    return data;
  },

  // Register
  async register(userData) {
    const data = await this.api('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });

    this.token = data.token;
    this.user = data.user;
    localStorage.setItem('hsv_token', data.token);
    this.updateAuthUI();

    return data;
  },

  // Logout
  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('hsv_token');
    this.updateAuthUI();
    window.location.href = '/';
  },

  // Update UI based on auth state
  updateAuthUI() {
    const authButtons = document.querySelector('.navbar-actions');
    if (!authButtons) return;

    if (this.user) {
      authButtons.innerHTML = `
        <a href="/dashboard" class="btn btn-outline btn-sm">Dashboard</a>
        <button onclick="App.logout()" class="btn btn-primary btn-sm">Logout</button>
      `;
    } else {
      authButtons.innerHTML = `
        <a href="/login" class="btn btn-outline btn-sm">Login</a>
        <a href="/register" class="btn btn-primary btn-sm">Get Started</a>
      `;
    }
  },

  // Setup navigation
  setupNavigation() {
    // Mobile menu toggle
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navMenu = document.querySelector('.navbar-nav');

    if (mobileMenuBtn && navMenu) {
      mobileMenuBtn.addEventListener('click', () => {
        navMenu.classList.toggle('active');
      });
    }

    // Close mobile menu on link click
    document.querySelectorAll('.navbar-nav a').forEach(link => {
      link.addEventListener('click', () => {
        navMenu?.classList.remove('active');
      });
    });
  },

  // Setup scroll effects
  setupScrollEffects() {
    const navbar = document.querySelector('.navbar');

    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        navbar?.classList.add('scrolled');
      } else {
        navbar?.classList.remove('scrolled');
      }
    });

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  },

  // Setup forms
  setupForms() {
    // Contact form
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
      contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(contactForm);
        const data = Object.fromEntries(formData);

        try {
          await this.api('/leads/contact', {
            method: 'POST',
            body: JSON.stringify(data)
          });

          this.showAlert('Thank you! We\'ll get back to you soon.', 'success');
          contactForm.reset();
        } catch (error) {
          this.showAlert(error.message, 'error');
        }
      });
    }
  },

  // Chat Widget
  chatSessionId: null,
  chatPollInterval: null,

  setupChatWidget() {
    const chatWidget = document.querySelector('.chat-widget');
    if (!chatWidget) return;

    const toggle = chatWidget.querySelector('.chat-toggle');
    const window = chatWidget.querySelector('.chat-window');
    const close = chatWidget.querySelector('.chat-close');
    const input = chatWidget.querySelector('.chat-input input');
    const sendBtn = chatWidget.querySelector('.chat-input button');

    toggle?.addEventListener('click', () => {
      window?.classList.toggle('active');
      if (window?.classList.contains('active')) {
        this.initChat();
      }
    });

    close?.addEventListener('click', () => {
      window?.classList.remove('active');
      this.stopChatPoll();
    });

    sendBtn?.addEventListener('click', () => this.sendChatMessage());
    input?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChatMessage();
    });
  },

  async initChat() {
    if (this.chatSessionId) return;

    try {
      const data = await this.api('/chat/session', { method: 'POST' });
      this.chatSessionId = data.sessionId;
      this.loadChatMessages();
      this.startChatPoll();
    } catch (error) {
      console.error('Failed to init chat:', error);
    }
  },

  async sendChatMessage() {
    const input = document.querySelector('.chat-input input');
    const message = input?.value.trim();

    if (!message || !this.chatSessionId) return;

    input.value = '';

    // Add message to UI immediately
    this.addChatMessage('client', message);

    try {
      await this.api('/chat/message', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: this.chatSessionId,
          message
        })
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  },

  async loadChatMessages() {
    if (!this.chatSessionId) return;

    try {
      const messages = await this.api(`/chat/messages/${this.chatSessionId}`);
      const container = document.querySelector('.chat-messages');
      if (container) {
        container.innerHTML = '';
        messages.forEach(msg => {
          this.addChatMessage(msg.sender, msg.message, msg.created_at);
        });
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  },

  addChatMessage(sender, message, timestamp = new Date()) {
    const container = document.querySelector('.chat-messages');
    if (!container) return;

    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = `chat-message ${sender}`;
    div.innerHTML = `
      <div class="message-content">${this.escapeHtml(message)}</div>
      <div class="message-time">${time}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  startChatPoll() {
    this.chatPollInterval = setInterval(async () => {
      if (!this.chatSessionId) return;

      try {
        const messages = await this.api(`/chat/poll/${this.chatSessionId}`);
        messages.forEach(msg => {
          if (msg.sender !== 'client') {
            const existing = document.querySelector(`[data-msg-id="${msg.id}"]`);
            if (!existing) {
              this.addChatMessage(msg.sender, msg.message, msg.created_at);
            }
          }
        });
      } catch (error) {
        console.error('Poll error:', error);
      }
    }, 3000);
  },

  stopChatPoll() {
    if (this.chatPollInterval) {
      clearInterval(this.chatPollInterval);
      this.chatPollInterval = null;
    }
  },

  // Utility functions
  showAlert(message, type = 'info') {
    const container = document.getElementById('alert-container') || document.body;
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.style.position = 'fixed';
    alert.style.top = '100px';
    alert.style.right = '20px';
    alert.style.zIndex = '9999';
    alert.style.minWidth = '300px';

    container.appendChild(alert);

    setTimeout(() => {
      alert.remove();
    }, 5000);
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  },

  formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
};

// Lead Magnet Tools
const Tools = {
  // Credit Score Calculator
  creditCalculator: {
    currentQuestion: 0,
    answers: {},
    questions: [
      {
        id: 'paymentHistory',
        question: 'How would you describe your payment history?',
        options: [
          { value: 'excellent', label: 'Never missed a payment' },
          { value: 'good', label: 'Missed 1-2 payments in the past' },
          { value: 'fair', label: 'Occasionally late on payments' },
          { value: 'poor', label: 'Frequently missed payments' }
        ]
      },
      {
        id: 'creditUtilization',
        question: 'How much of your available credit do you typically use?',
        options: [
          { value: 'low', label: 'Less than 30%' },
          { value: 'moderate', label: '30-50%' },
          { value: 'high', label: '50-80%' },
          { value: 'very_high', label: 'More than 80%' }
        ]
      },
      {
        id: 'creditAge',
        question: 'How long have you had credit accounts?',
        options: [
          { value: 'long', label: 'Over 10 years' },
          { value: 'medium', label: '5-10 years' },
          { value: 'short', label: '2-5 years' },
          { value: 'new', label: 'Less than 2 years' }
        ]
      },
      {
        id: 'creditMix',
        question: 'What types of credit do you have?',
        options: [
          { value: 'diverse', label: 'Multiple types (cards, loans, mortgage)' },
          { value: 'moderate', label: 'Some variety (cards and a loan)' },
          { value: 'limited', label: 'Just credit cards' }
        ]
      },
      {
        id: 'newCredit',
        question: 'How many new credit inquiries in the last year?',
        options: [
          { value: 'none', label: 'None' },
          { value: 'few', label: '1-2 inquiries' },
          { value: 'several', label: '3-5 inquiries' },
          { value: 'many', label: 'More than 5' }
        ]
      }
    ],

    init() {
      this.render();
    },

    render() {
      const container = document.getElementById('calculator-container');
      if (!container) return;

      if (this.currentQuestion >= this.questions.length) {
        this.showEmailForm();
        return;
      }

      const q = this.questions[this.currentQuestion];
      const progress = ((this.currentQuestion) / this.questions.length) * 100;

      container.innerHTML = `
        <div class="quiz-container">
          <div class="quiz-progress">
            <div class="quiz-progress-bar" style="width: ${progress}%"></div>
          </div>
          <div class="quiz-question">
            <h3>${q.question}</h3>
            <div class="quiz-options">
              ${q.options.map(opt => `
                <div class="quiz-option" onclick="Tools.creditCalculator.selectAnswer('${q.id}', '${opt.value}')">
                  ${opt.label}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    },

    selectAnswer(questionId, value) {
      this.answers[questionId] = value;
      this.currentQuestion++;
      this.render();
    },

    showEmailForm() {
      const container = document.getElementById('calculator-container');
      container.innerHTML = `
        <div class="quiz-container">
          <div class="card">
            <div class="card-body text-center">
              <h3>Get Your Credit Score Estimate</h3>
              <p>Enter your email to receive your personalized credit score estimate and improvement tips.</p>
              <form id="credit-email-form" class="mt-3">
                <div class="form-group">
                  <input type="text" name="firstName" class="form-input" placeholder="First Name" required>
                </div>
                <div class="form-group">
                  <input type="email" name="email" class="form-input" placeholder="Email Address" required>
                </div>
                <div class="form-group">
                  <input type="tel" name="phone" class="form-input" placeholder="Phone (optional)">
                </div>
                <button type="submit" class="btn btn-primary btn-lg btn-block">Get My Score</button>
              </form>
            </div>
          </div>
        </div>
      `;

      document.getElementById('credit-email-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        this.submitResults(Object.fromEntries(formData));
      });
    },

    async submitResults(userData) {
      try {
        const data = await App.api('/leads/credit-calculator', {
          method: 'POST',
          body: JSON.stringify({
            ...userData,
            ...this.answers
          })
        });

        this.showResults(data);
      } catch (error) {
        App.showAlert(error.message, 'error');
      }
    },

    showResults(data) {
      const container = document.getElementById('calculator-container');
      const scoreColor = data.estimatedScore >= 700 ? '#38a169' :
                         data.estimatedScore >= 650 ? '#dd6b20' : '#e53e3e';

      container.innerHTML = `
        <div class="result-card">
          <h2>Your Estimated Credit Score</h2>
          <div class="result-score" style="color: ${scoreColor}">${data.estimatedScore}</div>
          <div class="result-tier">${data.tier}</div>
          <p>${data.recommendation}</p>
          <div class="mt-4">
            <a href="/services/credit-repair" class="btn btn-primary btn-lg">Improve My Score</a>
            <a href="/contact" class="btn btn-outline btn-lg">Talk to an Expert</a>
          </div>
        </div>
      `;
    }
  },

  // Business Name Checker
  businessNameChecker: {
    async checkName() {
      const nameInput = document.getElementById('business-name');
      const stateInput = document.getElementById('business-state');
      const emailInput = document.getElementById('checker-email');

      const businessName = nameInput?.value.trim();
      const state = stateInput?.value;
      const email = emailInput?.value.trim();

      if (!businessName || !email) {
        App.showAlert('Please enter both business name and email', 'error');
        return;
      }

      try {
        const data = await App.api('/leads/business-name', {
          method: 'POST',
          body: JSON.stringify({
            businessName,
            state,
            email
          })
        });

        this.showResults(data);
      } catch (error) {
        App.showAlert(error.message, 'error');
      }
    },

    showResults(data) {
      const container = document.getElementById('name-results');
      if (!container) return;

      const statusIcon = data.available ? '✓' : '✗';
      const statusClass = data.available ? 'success' : 'warning';
      const statusText = data.available ? 'Available!' : 'May Be Taken';

      container.innerHTML = `
        <div class="card mt-3">
          <div class="card-body">
            <div class="text-center mb-3">
              <span class="badge badge-${statusClass}" style="font-size: 1.25rem; padding: 0.5rem 1.5rem;">
                ${statusIcon} ${statusText}
              </span>
            </div>
            <h4>"${data.businessName}"</h4>
            <p>${data.recommendation}</p>
            ${!data.available ? `
              <div class="mt-3">
                <h5>Alternative Suggestions:</h5>
                <ul>
                  ${data.suggestions.map(s => `<li>${s}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            <div class="mt-4 text-center">
              <a href="/services/business-formation" class="btn btn-primary">Register My Business</a>
            </div>
          </div>
        </div>
      `;
      container.classList.remove('hidden');
    }
  },

  // Funding Eligibility Quiz
  fundingQuiz: {
    currentQuestion: 0,
    answers: {},
    questions: [
      {
        id: 'businessAge',
        question: 'How long has your business been operating?',
        options: [
          { value: '0-6months', label: '0-6 months' },
          { value: '6-12months', label: '6-12 months' },
          { value: '1-2years', label: '1-2 years' },
          { value: '2-5years', label: '2-5 years' },
          { value: '5plus', label: '5+ years' }
        ]
      },
      {
        id: 'annualRevenue',
        question: 'What is your annual business revenue?',
        options: [
          { value: 'under50k', label: 'Under $50,000' },
          { value: '50k-100k', label: '$50,000 - $100,000' },
          { value: '100k-250k', label: '$100,000 - $250,000' },
          { value: '250k-500k', label: '$250,000 - $500,000' },
          { value: '500k-1m', label: '$500,000 - $1M' },
          { value: 'over1m', label: 'Over $1M' }
        ]
      },
      {
        id: 'creditScore',
        question: 'What is your personal credit score range?',
        options: [
          { value: 'excellent', label: '750+ (Excellent)' },
          { value: 'good', label: '700-749 (Good)' },
          { value: 'fair', label: '650-699 (Fair)' },
          { value: 'poor', label: 'Below 650 (Needs Work)' },
          { value: 'unknown', label: 'I\'m not sure' }
        ]
      },
      {
        id: 'businessType',
        question: 'What type of business do you have?',
        options: [
          { value: 'llc', label: 'LLC' },
          { value: 'corporation', label: 'Corporation' },
          { value: 'sole-prop', label: 'Sole Proprietorship' },
          { value: 'partnership', label: 'Partnership' }
        ]
      },
      {
        id: 'fundingAmount',
        question: 'How much funding are you looking for?',
        options: [
          { value: 'under25k', label: 'Under $25,000' },
          { value: '25k-50k', label: '$25,000 - $50,000' },
          { value: '50k-100k', label: '$50,000 - $100,000' },
          { value: '100k-250k', label: '$100,000 - $250,000' },
          { value: 'over250k', label: 'Over $250,000' }
        ]
      },
      {
        id: 'fundingPurpose',
        question: 'What will you use the funding for?',
        options: [
          { value: 'working-capital', label: 'Working Capital' },
          { value: 'equipment', label: 'Equipment Purchase' },
          { value: 'expansion', label: 'Business Expansion' },
          { value: 'inventory', label: 'Inventory' },
          { value: 'other', label: 'Other' }
        ]
      }
    ],

    init() {
      this.currentQuestion = 0;
      this.answers = {};
      this.render();
    },

    render() {
      const container = document.getElementById('quiz-container');
      if (!container) return;

      if (this.currentQuestion >= this.questions.length) {
        this.showEmailForm();
        return;
      }

      const q = this.questions[this.currentQuestion];
      const progress = ((this.currentQuestion) / this.questions.length) * 100;

      container.innerHTML = `
        <div class="quiz-container">
          <div class="quiz-progress">
            <div class="quiz-progress-bar" style="width: ${progress}%"></div>
          </div>
          <div class="quiz-question">
            <h3>${q.question}</h3>
            <div class="quiz-options">
              ${q.options.map(opt => `
                <div class="quiz-option" onclick="Tools.fundingQuiz.selectAnswer('${q.id}', '${opt.value}')">
                  ${opt.label}
                </div>
              `).join('')}
            </div>
          </div>
          ${this.currentQuestion > 0 ? `
            <button class="btn btn-outline mt-3" onclick="Tools.fundingQuiz.previousQuestion()">Back</button>
          ` : ''}
        </div>
      `;
    },

    selectAnswer(questionId, value) {
      this.answers[questionId] = value;
      this.currentQuestion++;
      this.render();
    },

    previousQuestion() {
      if (this.currentQuestion > 0) {
        this.currentQuestion--;
        this.render();
      }
    },

    showEmailForm() {
      const container = document.getElementById('quiz-container');
      container.innerHTML = `
        <div class="quiz-container">
          <div class="card">
            <div class="card-body text-center">
              <h3>Get Your Funding Eligibility Results</h3>
              <p>Enter your details to see what funding options you qualify for.</p>
              <form id="funding-email-form" class="mt-3">
                <div class="form-group">
                  <input type="text" name="firstName" class="form-input" placeholder="First Name" required>
                </div>
                <div class="form-group">
                  <input type="text" name="lastName" class="form-input" placeholder="Last Name" required>
                </div>
                <div class="form-group">
                  <input type="email" name="email" class="form-input" placeholder="Email Address" required>
                </div>
                <div class="form-group">
                  <input type="tel" name="phone" class="form-input" placeholder="Phone Number" required>
                </div>
                <button type="submit" class="btn btn-primary btn-lg btn-block">See My Results</button>
              </form>
            </div>
          </div>
        </div>
      `;

      document.getElementById('funding-email-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        this.submitResults(Object.fromEntries(formData));
      });
    },

    async submitResults(userData) {
      try {
        const data = await App.api('/leads/funding-quiz', {
          method: 'POST',
          body: JSON.stringify({
            ...userData,
            ...this.answers
          })
        });

        this.showResults(data);
      } catch (error) {
        App.showAlert(error.message, 'error');
      }
    },

    showResults(data) {
      const container = document.getElementById('quiz-container');
      const scoreColor = data.eligibilityScore >= 80 ? '#38a169' :
                         data.eligibilityScore >= 60 ? '#dd6b20' : '#e53e3e';

      container.innerHTML = `
        <div class="result-card">
          <h2>Your Funding Eligibility Score</h2>
          <div class="result-score" style="color: ${scoreColor}">${data.eligibilityScore}</div>
          <div class="result-tier">${data.tier} Eligibility</div>
          <p>Estimated Maximum Funding: <strong>${App.formatCurrency(data.estimatedMaxFunding)}</strong></p>
          <div class="mt-3">
            <h4>Recommended Funding Options:</h4>
            <ul style="list-style: none; padding: 0;">
              ${data.recommendedProducts.map(p => `<li style="padding: 0.5rem 0;">✓ ${p}</li>`).join('')}
            </ul>
          </div>
          <p class="mt-3">${data.nextSteps}</p>
          <div class="mt-4">
            <a href="/services/funding" class="btn btn-primary btn-lg">Explore Funding Options</a>
            <a href="/contact" class="btn btn-outline btn-lg">Schedule Consultation</a>
          </div>
        </div>
      `;
    }
  }
};

// Stripe Payment Handler
const Payments = {
  stripe: null,
  elements: null,

  async init() {
    try {
      const config = await App.api('/payments/config');
      if (config.demoMode) {
        console.log('Running in demo mode - Stripe not configured');
        return;
      }

      this.stripe = Stripe(config.publishableKey);
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
    }
  },

  async createPaymentForm(containerId, serviceId, amount) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!this.stripe) {
      // Demo mode
      container.innerHTML = `
        <div class="alert alert-info">
          <strong>Demo Mode:</strong> Stripe is not configured.
          Click the button below to simulate a successful payment.
        </div>
        <button class="btn btn-primary btn-lg btn-block mt-3"
                onclick="Payments.simulatePayment(${serviceId}, ${amount})">
          Complete Demo Purchase - ${App.formatCurrency(amount)}
        </button>
      `;
      return;
    }

    try {
      const { clientSecret } = await App.api('/payments/create-intent', {
        method: 'POST',
        body: JSON.stringify({ serviceId, amount })
      });

      this.elements = this.stripe.elements({ clientSecret });
      const paymentElement = this.elements.create('payment');
      paymentElement.mount(container);

      // Add submit handler
      const form = document.getElementById('payment-form');
      if (form) {
        form.addEventListener('submit', (e) => this.handleSubmit(e, serviceId, amount));
      }
    } catch (error) {
      App.showAlert('Failed to load payment form', 'error');
    }
  },

  async handleSubmit(e, serviceId, amount) {
    e.preventDefault();

    const submitBtn = document.getElementById('submit-payment');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    try {
      const { error, paymentIntent } = await this.stripe.confirmPayment({
        elements: this.elements,
        confirmParams: {
          return_url: `${window.location.origin}/dashboard?payment=success`
        },
        redirect: 'if_required'
      });

      if (error) {
        throw new Error(error.message);
      }

      // Confirm payment on backend
      await App.api('/payments/confirm', {
        method: 'POST',
        body: JSON.stringify({
          paymentIntentId: paymentIntent.id,
          serviceId,
          amount
        })
      });

      window.location.href = '/dashboard?payment=success';
    } catch (error) {
      App.showAlert(error.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Pay Now';
    }
  },

  async simulatePayment(serviceId, amount) {
    try {
      await App.api('/payments/confirm', {
        method: 'POST',
        body: JSON.stringify({
          paymentIntentId: 'demo_' + Date.now(),
          serviceId,
          amount,
          demoMode: true
        })
      });

      App.showAlert('Payment successful!', 'success');
      setTimeout(() => {
        window.location.href = '/dashboard?payment=success';
      }, 1500);
    } catch (error) {
      App.showAlert(error.message, 'error');
    }
  }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
