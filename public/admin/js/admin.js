// His Secret Vault - Admin Dashboard JavaScript

const AdminAPI = {
  apiUrl: '/api/admin',
  authUrl: '/api/auth',
  token: localStorage.getItem('hsv_admin_token'),

  // API Helper
  async api(endpoint, options = {}) {
    const url = endpoint.startsWith('/api') ? endpoint : `${this.apiUrl}${endpoint}`;
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

  // Authentication
  async login(email, password) {
    const data = await this.api('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    this.token = data.token;
    localStorage.setItem('hsv_admin_token', data.token);
    return data;
  },

  logout() {
    this.token = null;
    localStorage.removeItem('hsv_admin_token');
    window.location.href = '/admin/index.html';
  },

  isAuthenticated() {
    return !!this.token;
  },

  requireAuth() {
    if (!this.isAuthenticated()) {
      window.location.href = '/admin/index.html';
      return false;
    }
    return true;
  },

  // Dashboard
  async getDashboard() {
    return await this.api('/dashboard');
  },

  // Clients
  async getClients(params = {}) {
    const query = new URLSearchParams(params).toString();
    return await this.api(`/clients?${query}`);
  },

  async getClient(id) {
    return await this.api(`/clients/${id}`);
  },

  async updateClient(id, data) {
    return await this.api(`/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // Orders
  async getOrders(params = {}) {
    const query = new URLSearchParams(params).toString();
    return await this.api(`/orders?${query}`);
  },

  async getOrder(id) {
    return await this.api(`/orders/${id}`);
  },

  async updateOrder(id, data) {
    return await this.api(`/orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async updateOrderProgress(orderId, stepId, data) {
    return await this.api(`/orders/${orderId}/progress/${stepId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // Leads
  async getLeads(params = {}) {
    const query = new URLSearchParams(params).toString();
    return await this.api(`/leads?${query}`);
  },

  async convertLead(id) {
    return await this.api(`/leads/${id}/convert`, {
      method: 'PUT'
    });
  },

  // Contacts
  async getContacts(params = {}) {
    const query = new URLSearchParams(params).toString();
    return await this.api(`/contacts?${query}`);
  },

  async updateContact(id, data) {
    return await this.api(`/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // Services
  async getServices() {
    return await this.api('/services');
  },

  async updateService(id, data) {
    return await this.api(`/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // Subscriptions
  async getSubscriptions(params = {}) {
    const query = new URLSearchParams(params).toString();
    return await this.api(`/subscriptions?${query}`);
  },

  async getSubscription(id) {
    return await this.api(`/subscriptions/${id}`);
  },

  async cancelSubscription(id, immediate = false) {
    return await this.api(`/subscriptions/${id}/cancel`, {
      method: 'PUT',
      body: JSON.stringify({ immediate })
    });
  },

  // Plans & Bundles
  async getPlans() {
    return await this.api('/plans');
  },

  async updatePlan(id, data) {
    return await this.api(`/plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async updateBundle(id, data) {
    return await this.api(`/bundles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // DFY Orders
  async getDfyOrders(params = {}) {
    const query = new URLSearchParams(params).toString();
    return await this.api(`/dfy-orders?${query}`);
  },

  async getDfyOrder(id) {
    return await this.api(`/dfy-orders/${id}`);
  },

  async updateDfyOrder(id, data) {
    return await this.api(`/dfy-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async updateDfyOrderProgress(orderId, stepId, data) {
    return await this.api(`/dfy-orders/${orderId}/progress/${stepId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // UI Helpers
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
  },

  formatDateTime(date) {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  truncate(text, length) {
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
  },

  renderBadge(status) {
    const badgeMap = {
      // Order statuses
      'pending': 'badge-warning',
      'active': 'badge-info',
      'completed': 'badge-success',
      'cancelled': 'badge-danger',
      // Payment statuses
      'paid': 'badge-success',
      'unpaid': 'badge-warning',
      'refunded': 'badge-danger',
      // Progress statuses
      'in_progress': 'badge-info',
      // General
      'new': 'badge-warning',
      'responded': 'badge-success',
      'inactive': 'badge-danger'
    };

    const badgeClass = badgeMap[status] || 'badge-info';
    const displayText = status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    return `<span class="badge ${badgeClass}">${this.escapeHtml(displayText)}</span>`;
  },

  // Modal helpers
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  },

  // Pagination
  renderPagination(containerId, pagination, callback) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { page, pages, total } = pagination;

    if (pages <= 1) {
      container.innerHTML = '';
      return;
    }

    let html = '<div class="pagination-controls">';

    // Previous button
    if (page > 1) {
      html += `<button class="btn btn-sm btn-outline" onclick="${callback.name}(${page - 1})">Previous</button>`;
    }

    // Page numbers
    html += '<div class="page-numbers">';
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || (i >= page - 2 && i <= page + 2)) {
        const activeClass = i === page ? 'active' : '';
        html += `<button class="page-btn ${activeClass}" onclick="${callback.name}(${i})">${i}</button>`;
      } else if (i === page - 3 || i === page + 3) {
        html += '<span class="page-ellipsis">...</span>';
      }
    }
    html += '</div>';

    // Next button
    if (page < pages) {
      html += `<button class="btn btn-sm btn-outline" onclick="${callback.name}(${page + 1})">Next</button>`;
    }

    html += '</div>';
    container.innerHTML = html;
  },

  // Alerts
  showAlert(message, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-fixed`;
    alert.textContent = message;

    document.body.appendChild(alert);

    setTimeout(() => {
      alert.classList.add('fade-out');
      setTimeout(() => alert.remove(), 300);
    }, 5000);
  },

  showSuccess(message) {
    this.showAlert(message, 'success');
  },

  showError(message) {
    this.showAlert(message, 'error');
  },

  // Chart rendering (simple bar chart using canvas)
  renderRevenueChart(canvasId, revenueData) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const padding = 40;
    const width = canvas.offsetWidth;
    const height = 300;
    canvas.width = width;
    canvas.height = height;

    if (!revenueData || revenueData.length === 0) {
      ctx.fillStyle = '#718096';
      ctx.font = '14px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('No revenue data available', width / 2, height / 2);
      return;
    }

    // Find max value for scaling
    const maxValue = Math.max(...revenueData.map(d => d.total || 0));
    const chartHeight = height - padding * 2;
    const chartWidth = width - padding * 2;
    const barWidth = chartWidth / revenueData.length - 10;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw bars
    revenueData.forEach((item, index) => {
      const value = item.total || 0;
      const barHeight = (value / maxValue) * chartHeight;
      const x = padding + (index * (chartWidth / revenueData.length)) + 5;
      const y = height - padding - barHeight;

      // Draw bar
      const gradient = ctx.createLinearGradient(x, y, x, height - padding);
      gradient.addColorStop(0, '#2c5282');
      gradient.addColorStop(1, '#1a365d');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth, barHeight);

      // Draw month label
      ctx.fillStyle = '#4a5568';
      ctx.font = '12px Inter';
      ctx.textAlign = 'center';
      const monthLabel = item.month ? item.month.substring(5) : '';
      ctx.fillText(monthLabel, x + barWidth / 2, height - padding + 20);

      // Draw value
      ctx.fillStyle = '#1a202c';
      ctx.font = 'bold 12px Inter';
      const valueLabel = this.formatCurrency(value);
      ctx.fillText(valueLabel, x + barWidth / 2, y - 10);
    });

    // Draw axes
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();
  }
};

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
    document.body.style.overflow = '';
  }
});

// Handle escape key to close modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const activeModal = document.querySelector('.modal-overlay.active');
    if (activeModal) {
      activeModal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }
});
