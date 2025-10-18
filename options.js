/**
 * UI Module: Handles all DOM interactions and UI state.
 */
const UI = {
  init() {
    // Cache all DOM elements
    this.elements = {
      fileInput: document.getElementById('customTopicsFile'),
      saveButton: document.getElementById('save'),
      statusDiv: document.getElementById('status'),
      tabsToOpenInput: document.getElementById('tabsToOpen'),
      delayModeRadios: document.querySelectorAll('input[name="delayMode"]'),
      fixedDelaySettingDiv: document.getElementById('fixedDelaySetting'),
      fixedDelaySecondsInput: document.getElementById('fixedDelaySeconds'),
      scheduleTimeInput: document.getElementById('scheduleTime'),
      saveScheduleBtn: document.getElementById('saveSchedule'),
      cancelScheduleBtn: document.getElementById('cancelSchedule'),
      customTopicsArea: document.getElementById('customTopicsArea'),
      saveCustomTopicsBtn: document.getElementById('saveCustomTopics'),
      sidebarNav: document.getElementById('sidebar-nav'),
      contentSections: document.querySelectorAll('.content-section'),
      navLinks: document.querySelectorAll('#sidebar-nav a'),
      signatureDiv: document.getElementById('signature'),
      versionDisplay: document.getElementById('version-display'),
    };
  },

  showStatus(message, duration = 3000) {
    this.elements.statusDiv.textContent = message;
    this.elements.statusDiv.style.display = 'block';
    clearTimeout(this.elements.statusDiv.timeoutId);
    this.elements.statusDiv.timeoutId = setTimeout(() => {
      this.elements.statusDiv.style.display = 'none';
      this.elements.statusDiv.textContent = '';
    }, duration);
  },

  displayVersionAndSignature() {
    const manifest = chrome.runtime.getManifest();
    const version = manifest.version;
    const year = new Date().getFullYear();
    const signatureText = `HJZJZJ ©${year} - by minibom4 - Version ${version}`;

    if (this.elements.signatureDiv) this.elements.signatureDiv.textContent = signatureText;
    if (this.elements.versionDisplay) this.elements.versionDisplay.textContent = version;
  },

  populateSettings(settings) {
    if (settings.customTopics && Array.isArray(settings.customTopics) && settings.customTopics.length) {
      this.elements.customTopicsArea.value = settings.customTopics.join('\n');
    } else {
      this.elements.customTopicsArea.placeholder = 'Nhập mỗi chủ đề trên một dòng...\nVí dụ:\nLịch sử Việt Nam\nCông thức nấu ăn';
    }

    if (settings.tabsToOpen) this.elements.tabsToOpenInput.value = settings.tabsToOpen;
    if (settings.fixedDelaySeconds) this.elements.fixedDelaySecondsInput.value = settings.fixedDelaySeconds;
    
    const selectedMode = settings.delayMode || 'immediate';
    const radio = document.querySelector(`input[name="delayMode"][value="${selectedMode}"]`);
    if (radio) radio.checked = true;

    this.elements.fixedDelaySettingDiv.style.display = selectedMode === 'fixed' ? 'block' : 'none';
    if (settings.scheduleTime) this.elements.scheduleTimeInput.value = settings.scheduleTime;
  },

  getGeneralSettings() {
    const tabsToOpen = parseInt(this.elements.tabsToOpenInput.value, 10);
    const delayMode = document.querySelector('input[name="delayMode"]:checked').value;
    const fixedDelaySeconds = parseInt(this.elements.fixedDelaySecondsInput.value, 10);
    return { tabsToOpen, delayMode, fixedDelaySeconds };
  },

  getCustomTopics() {
    return this.elements.customTopicsArea.value.split('\n').map(t => t.trim()).filter(t => t !== '');
  },

  getScheduleTime() {
    return this.elements.scheduleTimeInput.value;
  },

  setCustomTopics(text) {
    this.elements.customTopicsArea.value = text;
  },

  clearScheduleTime() {
    this.elements.scheduleTimeInput.value = '';
  },

  switchSection(targetLink) {
    const sectionId = targetLink.getAttribute('data-section');
    this.elements.navLinks.forEach(link => link.classList.remove('active'));
    targetLink.classList.add('active');
    this.elements.contentSections.forEach(section => {
      section.classList.toggle('active', section.id === sectionId);
    });
  },
};

/**
 * Storage Module: Handles communication with chrome.storage and background script.
 */
const Storage = {
  load(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  },
  save(settings) {
    return new Promise(resolve => chrome.storage.local.set(settings, resolve));
  },
  remove(key) {
    return new Promise(resolve => chrome.storage.local.remove(key, resolve));
  },
  sendMessage(message) {
    chrome.runtime.sendMessage(message);
  },
};

/**
 * App Module: The main controller that wires everything together.
 */
const App = {
  async init() {
    UI.init();
    this.bindEvents();
    UI.displayVersionAndSignature();
    const settings = await Storage.load(['customTopics', 'tabsToOpen', 'delayMode', 'fixedDelaySeconds', 'scheduleTime']);
    UI.populateSettings(settings);
  },

  bindEvents() {
    UI.elements.saveButton.addEventListener('click', this.handleSaveGeneral.bind(this));
    UI.elements.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
    UI.elements.saveCustomTopicsBtn.addEventListener('click', this.handleSaveCustomTopics.bind(this));
    UI.elements.saveScheduleBtn.addEventListener('click', this.handleSaveSchedule.bind(this));
    UI.elements.cancelScheduleBtn.addEventListener('click', this.handleCancelSchedule.bind(this));
    UI.elements.sidebarNav.addEventListener('click', this.handleSidebarNav.bind(this));
    UI.elements.delayModeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        UI.elements.fixedDelaySettingDiv.style.display = e.target.value === 'fixed' ? 'block' : 'none';
      });
    });
  },

  handleSidebarNav(e) {
    if (e.target.tagName === 'A') {
      e.preventDefault();
      UI.switchSection(e.target);
    }
  },

  async handleSaveGeneral() {
    const { tabsToOpen, delayMode, fixedDelaySeconds } = UI.getGeneralSettings();
    if (tabsToOpen < 1 || tabsToOpen > 100) { // Increased max to 100 as in HTML
      return UI.showStatus('Số lượt tìm kiếm không hợp lệ (phải từ 1 đến 100).', 4000);
    }
    if (delayMode === 'fixed' && fixedDelaySeconds < 1) {
      return UI.showStatus('Số giây delay không hợp lệ (phải lớn hơn 0).', 4000);
    }
    await Storage.save({ tabsToOpen, delayMode, fixedDelaySeconds });
    UI.showStatus('Đã lưu cài đặt chung!');
  },

  handleFileSelect(event) { // FileReader API is event-based, so async/await isn't directly applicable here.
    const file = event.target.files[0];
    if (!file || !file.name.endsWith('.txt')) {
      return UI.showStatus('Vui lòng chọn một tệp .txt.', 3000);
    }
    const reader = new FileReader();
    reader.onload = async (e) => { // Make the onload handler async
      const topics = e.target.result.split(/\r?\n/).filter(line => line.trim() !== '');
      if (topics.length > 0) {
        UI.setCustomTopics(topics.join('\n'));
        await this.handleSaveCustomTopics(); // Await the save operation
        UI.showStatus(`Đã tải lên ${topics.length} chủ đề từ tệp.`, 4000);
      } else {
        UI.showStatus('Tệp không có nội dung hoặc định dạng không đúng.', 3000);
      }
    };
    reader.onerror = () => UI.showStatus('Đã xảy ra lỗi khi đọc tệp.', 3000);
    reader.readAsText(file);
  },

  async handleSaveCustomTopics() {
    const topics = UI.getCustomTopics();
    await Storage.save({ customTopics: topics });
    UI.showStatus('Danh sách chủ đề tùy chỉnh đã được lưu.');
  },

  async handleSaveSchedule() {
    const time = UI.getScheduleTime();
    if (!time) {
      return UI.showStatus('Vui lòng chọn thời gian hợp lệ.', 3000);
    }
    await Storage.save({ scheduleTime: time });
    Storage.sendMessage({ action: 'scheduleRun', time: time });
    UI.showStatus(`Đã lên lịch chạy tự động vào lúc ${time} hàng ngày.`);
  },

  async handleCancelSchedule() {
    await Storage.remove('scheduleTime');
    Storage.sendMessage({ action: 'cancelSchedule' });
    UI.clearScheduleTime();
    UI.showStatus('Đã hủy lịch chạy tự động.');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
