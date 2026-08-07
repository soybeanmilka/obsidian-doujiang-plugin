var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TimerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  durationMinutes: 20,
  breakMinutes: 5,
  breakMessage: "\u4F11\u606F\u7ED3\u675F\uFF0C\u7EE7\u7EED\u52A0\u6CB9\uFF01",
  sessionType: "work",
  message: "\u8BE5\u559D\u6C34\u4E86\uFF01",
  showStatusBar: true,
  floatingPosition: null,
  darkBgColor: "#F5F4F0",
  lightBgColor: "#424242",
  isRunning: false,
  isPaused: false,
  savedTargetTime: null,
  savedTimeLeft: null,
  countMode: "real",
  dailyStats: {},
  todos: [],
  timeFormat: "auto",
  autoStartOnLaunch: false
  // 默认关闭自启
};
var TimerPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.timerInterval = null;
    this.targetTime = 0;
    this.timeLeft = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.sessionType = "work";
    // 用于应对“仅运行时模式”下电脑休眠带来的时间跳跃
    this.lastTickTime = 0;
    this.lastSaveTime = 0;
    this.floatingWindow = null;
  }
  async onload() {
    await this.loadSettings();
    this.applyCustomStyles();
    this.ribbonIconEl = this.addRibbonIcon("clock", "\u5F00\u542F\u5012\u8BA1\u65F6", (evt) => {
      this.toggleTimer();
    });
    this.statusBarItemEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.statusBarItemEl.addEventListener("click", () => this.openPanel("todo"));
    this.addSettingTab(new TimerSettingTab(this.app, this));
    this.addCommand({
      id: "show-pomodoro-stats",
      name: "打开豆浆面板",
      callback: () => this.openPanel("stats")
    });
    this.addCommand({
      id: "quick-add-todo",
      name: "快速添加待办",
      callback: () => this.openPanel("todo")
    });
    const hadPendingTask = this.settings.isRunning;
    this.resumeTimerIfRunning();
    if (this.settings.autoStartOnLaunch && !hadPendingTask) {
      this.startTimer();
    }
  }
  async onunload() {
    if (this.isRunning) {
      this.settings.savedTimeLeft = this.timeLeft;
      this.settings.savedTargetTime = this.targetTime;
      await this.saveData(this.settings);
    }
    if (this.timerInterval) {
      window.clearInterval(this.timerInterval);
    }
    if (this.floatingWindow) {
      this.floatingWindow.close();
    }
    this.removeCustomStyles();
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    let migrated = false;
    for (const t of this.settings.todos || []) {
      if (!t.date) {
        t.date = dateKeyOf(t.created);
        migrated = true;
      }
    }
    if (migrated) await this.saveData(this.settings);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  applyCustomStyles() {
    let styleEl = document.getElementById("timer-custom-styles");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "timer-custom-styles";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
			body.theme-dark { --capsule-bg: ${this.settings.darkBgColor}; }
			body.theme-light { --capsule-bg: ${this.settings.lightBgColor}; }
		`;
  }
  removeCustomStyles() {
    const styleEl = document.getElementById("timer-custom-styles");
    if (styleEl) {
      styleEl.remove();
    }
  }
  // 核心：重启后恢复倒计时逻辑
  resumeTimerIfRunning() {
    if (!this.settings.isRunning) return;
    this.sessionType = this.settings.sessionType || "work";
    if (this.settings.isPaused) {
      this.timeLeft = this.settings.savedTimeLeft || 0;
      this.isPaused = true;
      this.isRunning = false;
      this.ribbonIconEl.addClass("timer-ribbon-running");
      this.updateStatusBar();
      return;
    }
    const now = Date.now();
    if (this.settings.countMode === "real") {
      if (this.settings.savedTargetTime) {
        if (now >= this.settings.savedTargetTime) {
          this.stopTimer();
          this.triggerAlarm();
        } else {
          this.targetTime = this.settings.savedTargetTime;
          this.timeLeft = Math.round((this.targetTime - now) / 1e3);
          this._startInterval();
        }
      }
    } else if (this.settings.countMode === "app") {
      if (this.settings.savedTimeLeft && this.settings.savedTimeLeft > 0) {
        this.timeLeft = this.settings.savedTimeLeft;
        this.targetTime = now + this.timeLeft * 1e3;
        this._startInterval();
      } else {
        this.stopTimer();
        this.triggerAlarm();
      }
    }
  }
  toggleTimer() {
    if (this.isRunning) {
      this.stopTimer();
    } else {
      this.startTimer();
    }
  }
  async startTimer() {
    this.isPaused = false;
    this.settings.isPaused = false;
    this.sessionType = "work";
    this.settings.sessionType = "work";
    if (this.floatingWindow) {
      this.floatingWindow.close();
      this.floatingWindow = null;
    }
    const durationMs = this.settings.durationMinutes * 60 * 1e3;
    this.targetTime = Date.now() + durationMs;
    this.timeLeft = Math.round(durationMs / 1e3);
    this.settings.isRunning = true;
    this.settings.savedTargetTime = this.targetTime;
    this.settings.savedTimeLeft = this.timeLeft;
    await this.saveSettings();
    this._startInterval();
  }
  async startBreak() {
    this.isPaused = false;
    this.settings.isPaused = false;
    this.sessionType = "break";
    this.settings.sessionType = "break";
    if (this.floatingWindow) {
      this.floatingWindow.close();
      this.floatingWindow = null;
    }
    const durationMs = this.settings.breakMinutes * 60 * 1e3;
    this.targetTime = Date.now() + durationMs;
    this.timeLeft = Math.round(durationMs / 1e3);
    this.settings.isRunning = true;
    this.settings.savedTargetTime = this.targetTime;
    this.settings.savedTimeLeft = this.timeLeft;
    await this.saveSettings();
    this._startInterval();
  }
  _startInterval() {
    this.isRunning = true;
    this.lastTickTime = Date.now();
    this.lastSaveTime = Date.now();
    (0, import_obsidian.setIcon)(this.ribbonIconEl, "stop-circle");
    this.ribbonIconEl.setAttribute("aria-label", "\u505C\u6B62\u5012\u8BA1\u65F6");
    this.ribbonIconEl.addClass("timer-ribbon-running");
    if (this.timerInterval) {
      window.clearInterval(this.timerInterval);
    }
    this.timerInterval = window.setInterval(() => this.tick(), 1e3);
    this.updateStatusBar();
    if (this.panelModal) this.panelModal.updateTimer();
  }
  async stopTimer() {
    this.isRunning = false;
    this.isPaused = false;
    this.settings.isRunning = false;
    this.settings.isPaused = false;
    this.settings.savedTargetTime = null;
    this.settings.savedTimeLeft = null;
    this.saveData(this.settings).catch((e) => console.error(e));
    if (this.timerInterval) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.floatingWindow) {
      this.floatingWindow.close();
      this.floatingWindow = null;
    }
    (0, import_obsidian.setIcon)(this.ribbonIconEl, "clock");
    this.ribbonIconEl.setAttribute("aria-label", "\u5F00\u542F\u5012\u8BA1\u65F6");
    this.ribbonIconEl.removeClass("timer-ribbon-running");
    this.updateStatusBar();
    if (this.panelModal) this.panelModal.updateTimer();
  }
  async pauseTimer() {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    this.isRunning = false;
    this.settings.isPaused = true;
    this.settings.savedTimeLeft = this.timeLeft;
    this.settings.savedTargetTime = this.targetTime;
    if (this.timerInterval) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    await this.saveSettings();
    this.updateStatusBar();
    if (this.panelModal) this.panelModal.updateTimer();
  }
  async resumeTimer() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.settings.isPaused = false;
    this.targetTime = Date.now() + this.timeLeft * 1e3;
    this.settings.savedTargetTime = this.targetTime;
    await this.saveSettings();
    this._startInterval();
  }
  _clockText(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mode = this.settings.timeFormat || "auto";
    const useHours = mode === "hours" || (mode === "auto" && h > 0);
    if (useHours) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  _statText(minutes) {
    const total = Math.round(minutes);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h} 小时 ${m} 分` : `${total} 分钟`;
  }
  _formatTime() {
    return `\u23F3 ${this._clockText(this.timeLeft)}`;
  }
  _timerText() {
    if (this.sessionType === "break") return this._formatTime().replace("\u23F3", "\uD83C\uDFD6\uFE0F");
    return this._formatTime();
  }
  tick() {
    const now = Date.now();
    const delta = now - this.lastTickTime;
    this.lastTickTime = now;
    if (this.settings.countMode === "app" && delta > 2e3) {
      this.targetTime += delta - 1e3;
    }
    this.timeLeft = Math.max(0, Math.round((this.targetTime - now) / 1e3));
    this.updateStatusBar();
    if (this.panelModal) this.panelModal.updateTimer();
    if (this.timeLeft <= 0) {
      this.stopTimer();
      if (this.sessionType === "break") this.triggerBreakEnd();
      else this.triggerAlarm();
      return;
    }
    if (now - this.lastSaveTime >= 1e4) {
      this.settings.savedTimeLeft = this.timeLeft;
      this.settings.savedTargetTime = this.targetTime;
      this.saveData(this.settings).catch((e) => console.error(e));
      this.lastSaveTime = now;
    }
  }
  triggerAlarm() {
    this.recordPomodoro();
    if (this.panelModal) this.panelModal.refreshData();
    if (this.floatingWindow) {
      this.floatingWindow.close();
      this.floatingWindow = null;
    }
    this.floatingWindow = new TimerFloatingWindow(this, "alarm");
    this.floatingWindow.open();
  }
  triggerBreakEnd() {
    if (this.panelModal) this.panelModal.refreshData();
    if (this.floatingWindow) {
      this.floatingWindow.close();
      this.floatingWindow = null;
    }
    this.floatingWindow = new TimerFloatingWindow(this, "breakEnd");
    this.floatingWindow.open();
  }
  openPanel(tab) {
    if (this.panelModal) this.panelModal.close();
    this.panelModal = new TimerPanelModal(this.app, this, tab || "stats");
    this.panelModal.open();
  }
  _newTodoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  addTodo(text, date) {
    if (!this.settings.todos) this.settings.todos = [];
    this.settings.todos.push({
      id: this._newTodoId(),
      text,
      done: false,
      created: Date.now(),
      date: date || dateKeyOf(Date.now())
    });
    this.saveSettings();
    if (this.panelModal) this.panelModal.renderTodos();
  }
  setTodoDate(id, date) {
    const t = (this.settings.todos || []).find((x) => x.id === id);
    if (!t || !date) return;
    t.date = date;
    this.saveSettings();
    if (this.panelModal) this.panelModal.renderTodos();
  }
  toggleTodo(id) {
    const t = (this.settings.todos || []).find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    this.saveSettings();
    if (this.panelModal) this.panelModal.renderTodos();
  }
  removeTodo(id) {
    this.settings.todos = (this.settings.todos || []).filter((x) => x.id !== id);
    this.saveSettings();
    if (this.panelModal) this.panelModal.renderTodos();
  }
  _todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  recordPomodoro() {
    if (!this.settings.dailyStats) this.settings.dailyStats = {};
    const key = this._todayKey();
    if (!this.settings.dailyStats[key]) this.settings.dailyStats[key] = [];
    this.settings.dailyStats[key].push({ t: Date.now(), m: this.settings.durationMinutes });
    this.saveSettings();
    this.updateStatusBar();
  }
  updateStatusBar() {
    if (!this.settings.showStatusBar) {
      this.statusBarItemEl.setText("");
      this.statusBarItemEl.style.display = "none";
      return;
    }
    if (this.isRunning) {
      this.statusBarItemEl.style.display = "inline-block";
      const timeString = this._clockText(this.timeLeft);
      const runIcon = this.sessionType === "break" ? "\uD83C\uDFD6\uFE0F" : "\u23F3";
      this.statusBarItemEl.setText(`${runIcon} ${timeString}`);
      return;
    }
    if (this.isPaused) {
      this.statusBarItemEl.style.display = "inline-block";
      const timeString = this._clockText(this.timeLeft);
      const pauseIcon = this.sessionType === "break" ? "\uD83C\uDFD6\uFE0F" : "\u23F8";
      this.statusBarItemEl.setText(`${pauseIcon} ${timeString}`);
      return;
    }
    const entries = (this.settings.dailyStats || {})[this._todayKey()];
    if (entries && entries.length > 0) {
      const totalMinutes = entries.reduce((s, e) => s + e.m, 0);
      this.statusBarItemEl.style.display = "inline-block";
      this.statusBarItemEl.setText(`\uD83C\uDF45 今天 ${entries.length} 个 · ${this._statText(totalMinutes)}`);
      return;
    }
    this.statusBarItemEl.setText("");
    this.statusBarItemEl.style.display = "none";
  }
};
var TimerFloatingWindow = class {
  constructor(plugin, mode = "alarm") {
    this.windowEl = null;
    this.textEl = null;
    this.currentDoc = null;
    this.currentWin = null;
    this.isDragging = false;
    this.dragMoved = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.onPointerMove = this._onPointerMove.bind(this);
    this.onPointerUp = this._onPointerUp.bind(this);
    this.plugin = plugin;
    this.mode = mode;
  }
  open() {
    this.close();
    this.currentDoc = window.activeDocument ?? document;
    this.currentWin = window.activeWindow ?? window;
    if (!this.currentDoc || !this.currentWin) return;
    this.windowEl = this.currentDoc.createElement("div");
    this.windowEl.addClass("timer-floating-window");
    if (this.mode !== "running") this.windowEl.addClass("timer-alarm-pop");
    this.currentDoc.body.appendChild(this.windowEl);
    if (this.mode === "running") {
      const stopBtn = this.windowEl.createEl("button", { cls: ["timer-btn", "timer-btn-stop"] });
      (0, import_obsidian.setIcon)(stopBtn, "stop-circle");
      stopBtn.addEventListener("click", () => {
        this.plugin.stopTimer();
        this.close();
      });
      this.textEl = this.windowEl.createDiv({ text: "\u23F3 00:00", cls: "timer-floating-window-text" });
    } else {
      const repeatBtn = this.windowEl.createEl("button", { cls: ["timer-btn", "timer-btn-repeat"] });
      (0, import_obsidian.setIcon)(repeatBtn, "play");
      repeatBtn.addEventListener("click", () => {
        this.plugin.startTimer();
        this.close();
      });
      const isBreak = this.mode === "breakEnd";
      const message = isBreak
        ? this.plugin.settings.breakMessage || "\u4F11\u606F\u7ED3\u675F\uFF0C\u7EE7\u7EED\u52A0\u6CB9\uFF01"
        : this.plugin.settings.message || "\u65F6\u95F4\u5230\uFF01";
      this.textEl = this.windowEl.createDiv({ cls: "timer-floating-window-text" });
      this.textEl.createSpan({ cls: "timer-celebrate", text: isBreak ? "\uD83D\uDCAA" : "\uD83C\uDF89" });
      this.textEl.createSpan({ cls: "timer-alarm-message", text: message });
      if (!isBreak) {
        this.textEl.createSpan({
          cls: "timer-alarm-hint",
          text: `\u23F1 \u70B9\u51FB\u5F00\u59CB ${this.plugin.settings.breakMinutes} \u5206\u949F\u4F11\u606F`
        });
      }
      this.textEl.addEventListener("click", (e) => {
        if (e.target.closest(".timer-btn")) return;
        if (isBreak) this.plugin.startTimer();
        else this.plugin.startBreak();
        this.close();
      });
    }
    const closeBtn = this.windowEl.createEl("button", { cls: ["timer-btn", "timer-btn-close"] });
    (0, import_obsidian.setIcon)(closeBtn, "x");
    closeBtn.addEventListener("click", () => {
      this.close();
    });
    setTimeout(() => {
      if (!this.windowEl || !this.currentWin) return;
      const rect = this.windowEl.getBoundingClientRect();
      let targetX, targetY;
      if (this.plugin.settings.floatingPosition) {
        targetX = this.plugin.settings.floatingPosition.x;
        targetY = this.plugin.settings.floatingPosition.y;
      } else {
        targetX = (this.currentWin.innerWidth - rect.width) / 2;
        targetY = this.currentWin.innerHeight * 0.15;
      }
      this.setPosition(targetX, targetY);
      this.windowEl.style.visibility = "visible";
    }, 0);
    this.windowEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".timer-btn")) return;
      this.isDragging = true;
      this.dragMoved = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      const rect = this.windowEl.getBoundingClientRect();
      this.offsetX = e.clientX - rect.left;
      this.offsetY = e.clientY - rect.top;
      this.currentDoc?.addEventListener("pointermove", this.onPointerMove);
      this.currentDoc?.addEventListener("pointerup", this.onPointerUp);
    });
  }
  setTimeText(text) {
    if (this.textEl) this.textEl.setText(text);
  }
  setPosition(x, y) {
    if (!this.windowEl || !this.currentWin) return;
    const rect = this.windowEl.getBoundingClientRect();
    const maxX = this.currentWin.innerWidth - rect.width;
    const maxY = this.currentWin.innerHeight - rect.height;
    const clampedX = Math.max(0, Math.min(x, maxX));
    const clampedY = Math.max(0, Math.min(y, maxY));
    this.windowEl.style.left = `${clampedX}px`;
    this.windowEl.style.top = `${clampedY}px`;
  }
  _onPointerMove(e) {
    if (!this.isDragging || !this.windowEl) return;
    if (!this.dragMoved) {
      if (Math.abs(e.clientX - this.dragStartX) < 4 && Math.abs(e.clientY - this.dragStartY) < 4) return;
      this.dragMoved = true;
      this.windowEl.addClass("is-dragging");
    }
    const newX = e.clientX - this.offsetX;
    const newY = e.clientY - this.offsetY;
    this.setPosition(newX, newY);
  }
  async _onPointerUp(e) {
    if (this.isDragging) {
      this.isDragging = false;
      this.windowEl?.removeClass("is-dragging");
      this.currentDoc?.removeEventListener("pointermove", this.onPointerMove);
      this.currentDoc?.removeEventListener("pointerup", this.onPointerUp);
      if (this.windowEl && this.dragMoved) {
        const rect = this.windowEl.getBoundingClientRect();
        this.plugin.settings.floatingPosition = {
          x: rect.left,
          y: rect.top
        };
        await this.plugin.saveSettings();
      }
    }
  }
  close() {
    if (this.windowEl && this.windowEl.parentElement) {
      this.windowEl.parentElement.removeChild(this.windowEl);
      this.windowEl = null;
    }
    this.currentDoc?.removeEventListener("pointermove", this.onPointerMove);
    this.currentDoc?.removeEventListener("pointerup", this.onPointerUp);
    this.currentDoc = null;
    this.currentWin = null;
  }
};
function dateKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
var TimerPanelModal = class extends import_obsidian.Modal {
  constructor(app, plugin, initialTab) {
    super(app);
    this.plugin = plugin;
    this.activeTab = initialTab || "stats";
    const now = new Date();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
    this.selectedDate = null;
    this.pendingDate = null;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("timer-panel-modal");
    this.modalEl.addClass("timer-panel-modal");
    this.updateTitle();
    this.makeDraggable();

    const controlRow = contentEl.createDiv({ cls: "timer-panel-control" });
    this.timerBtn = controlRow.createEl("button", { cls: "timer-panel-start-btn", text: "开始" });
    this.timerBtn.addEventListener("click", () => {
      if (this.plugin.isRunning) this.plugin.pauseTimer();
      else if (this.plugin.isPaused) this.plugin.resumeTimer();
      else this.plugin.startTimer();
      this.updateTimer();
    });
    this.stopBtn = controlRow.createEl("button", { cls: "timer-panel-stop-btn", text: "停止" });
    this.stopBtn.style.display = "none";
    this.stopBtn.addEventListener("click", () => {
      this.plugin.stopTimer();
      this.updateTimer();
    });
    this.timerLabel = controlRow.createSpan({ cls: "timer-panel-time" });

    const progressWrap = contentEl.createDiv({ cls: "timer-progress" });
    this.progressFill = progressWrap.createDiv({ cls: "timer-progress-fill" });

    const tabRow = contentEl.createDiv({ cls: "timer-panel-tabs" });
    this.tabBtns = {};
    for (const [id, name] of [["todo", "待办"], ["stats", "统计"], ["calendar", "日历"]]) {
      const btn = tabRow.createEl("button", {
        cls: "timer-panel-tab" + (id === this.activeTab ? " is-active" : ""),
        text: name
      });
      btn.addEventListener("click", () => this.switchTab(id));
      this.tabBtns[id] = btn;
    }

    this.tabBody = contentEl.createDiv({ cls: "timer-panel-body" });
    this.renderTab();
    this.updateTimer();
    if (this.activeTab === "todo") setTimeout(() => this.todoInput?.focus(), 100);
  }
  switchTab(id) {
    this.activeTab = id;
    for (const k in this.tabBtns) this.tabBtns[k].removeClass("is-active");
    this.tabBtns[id].addClass("is-active");
    this.updateTitle();
    this.renderTab();
    if (id === "todo") setTimeout(() => this.todoInput?.focus(), 50);
  }
  tabTitle() {
    const icons = { todo: "📋待办", stats: "📊统计", calendar: "📅日历" };
    return `🍅 豆浆的小插件 · ${icons[this.activeTab] || ""}`;
  }
  updateTitle() {
    const titleEl = this.modalEl.querySelector(".modal-title");
    if (!titleEl) return;
    titleEl.innerHTML = `<span class="timer-title-tomato">🍅</span> ${this.tabTitle().replace("🍅", "").trim()}`;
    this.titleTomato = titleEl.querySelector(".timer-title-tomato");
    if (this.titleTomato) {
      if (this.plugin.isRunning || this.plugin.isPaused) this.titleTomato.addClass("is-excited");
      else this.titleTomato.removeClass("is-excited");
    }
  }
  renderTab() {
    this.tabBody.empty();
    if (this.activeTab === "todo") this.renderTodoTab();
    else if (this.activeTab === "stats") this.renderStatsTab();
    else this.renderCalendarTab();
  }
  refreshData() {
    this.renderTab();
    this.updateTimer();
  }
  updateTimer() {
    if (!this.timerBtn) return;
    if (this.plugin.isRunning) {
      this.timerBtn.setText("暂停");
      this.timerBtn.addClass("is-running");
      this.timerLabel.setText(this.plugin._timerText());
      this.stopBtn.style.display = "";
    } else if (this.plugin.isPaused) {
      this.timerBtn.setText("继续");
      this.timerBtn.addClass("is-running");
      this.timerLabel.setText(this.plugin._timerText());
      this.stopBtn.style.display = "";
    } else {
      this.timerBtn.setText("开始");
      this.timerBtn.removeClass("is-running");
      this.timerLabel.setText(this.plugin._clockText(this.plugin.settings.durationMinutes * 60));
      this.stopBtn.style.display = "none";
    }
    if (this.progressFill) {
      const total = this.plugin.settings.durationMinutes * 60;
      let pct = total > 0 ? (this.plugin.timeLeft / total) * 100 : 100;
      if (!this.plugin.isRunning && !this.plugin.isPaused) pct = 100;
      this.progressFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
      if (this.plugin.sessionType === "break") this.progressFill.addClass("is-break");
      else this.progressFill.removeClass("is-break");
      if (this.plugin.isPaused) this.progressFill.addClass("is-paused");
      else this.progressFill.removeClass("is-paused");
    }
    if (this.titleTomato) {
      if (this.plugin.isRunning || this.plugin.isPaused) this.titleTomato.addClass("is-excited");
      else this.titleTomato.removeClass("is-excited");
    }
  }
  // ===== 待办 tab =====
  renderTodoTab() {
    const contentEl = this.tabBody;
    const inputRow = contentEl.createDiv({ cls: "timer-todo-input-row" });
    this.todoInput = inputRow.createEl("input", { cls: "timer-todo-input", type: "text", placeholder: "要做什么？回车添加" });
    this.todoDateInput = inputRow.createEl("input", { cls: "timer-todo-date", type: "date", attr: { title: "计划日期" } });
    this.todoDateInput.value = this.pendingDate || this.plugin._todayKey();
    const addBtn = inputRow.createEl("button", { cls: "timer-todo-add-btn", attr: { "aria-label": "添加" } });
    (0, import_obsidian.setIcon)(addBtn, "plus");
    const add = () => {
      const value = this.todoInput.value.trim();
      if (!value) return;
      this.plugin.addTodo(value, this.todoDateInput.value || this.plugin._todayKey());
      this.todoInput.value = "";
      this.todoInput.focus();
    };
    addBtn.addEventListener("click", add);
    this.todoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    this.todoListEl = contentEl.createDiv({ cls: "timer-todo-list" });
    this.renderTodos();
  }
  renderTodos() {
    if (!this.todoListEl) return;
    this.todoListEl.empty();
    const todos = this.plugin.settings.todos || [];
    if (todos.length === 0) {
      this.todoListEl.createDiv({ cls: "timer-todo-empty", text: "暂无待办，写一条吧" });
      return;
    }
    const today = this.plugin._todayKey();
    const sortByDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.created - a.created);
    const groups = [
      ["已过期", todos.filter((t) => !t.done && t.date < today).sort(sortByDate)],
      ["今天", todos.filter((t) => !t.done && t.date === today).sort(sortByDate)],
      ["以后", todos.filter((t) => !t.done && t.date > today).sort(sortByDate)],
      ["已完成", todos.filter((t) => t.done).sort(sortByDate)]
    ];
    for (const [title, items] of groups) {
      if (items.length === 0) continue;
      this.todoListEl.createDiv({ cls: "timer-todo-group-title", text: `${title}（${items.length}）` });
      for (const t of items) this.renderTodoRow(this.todoListEl, t);
    }
  }
  renderTodoRow(parent, t) {
    const row = parent.createDiv({ cls: "timer-todo-item" + (t.done ? " is-done" : "") });
    const cb = row.createEl("input", { cls: "timer-todo-checkbox", type: "checkbox" });
    cb.checked = t.done;
    cb.addEventListener("change", () => this.plugin.toggleTodo(t.id));
    row.createEl("span", { cls: "timer-todo-text", text: t.text });
    const dateInput = row.createEl("input", { cls: "timer-todo-date", type: "date", attr: { title: "修改计划日期" } });
    dateInput.value = t.date || this.plugin._todayKey();
    dateInput.addEventListener("change", () => this.plugin.setTodoDate(t.id, dateInput.value));
    const delBtn = row.createEl("button", { cls: "timer-todo-del", attr: { "aria-label": "删除" } });
    (0, import_obsidian.setIcon)(delBtn, "x");
    delBtn.addEventListener("click", () => this.plugin.removeTodo(t.id));
  }
  // ===== 统计 tab =====
  renderStatsTab() {
    const contentEl = this.tabBody;
    const stats = this.plugin.settings.dailyStats || {};
    const todayKey = this.plugin._todayKey();
    const today = stats[todayKey] || [];
    const todayMinutes = today.reduce((s, e) => s + e.m, 0);

    const todaySection = contentEl.createDiv({ cls: "timer-stats-section" });
    todaySection.createDiv({ cls: "timer-stats-section-title", text: "今日" });
    const summary = todaySection.createDiv({ cls: "timer-stats-summary" });
    summary.createDiv({ text: `今天（${todayKey}）：${today.length} 个番茄 · ${this.plugin._statText(todayMinutes)}` });
    if (today.length > 0) {
      const times = today.map((e) => new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      summary.createDiv({ cls: "timer-stats-times", text: "完成时间：" + times.join("、") });
    }

    const weekSection = contentEl.createDiv({ cls: "timer-stats-section" });
    weekSection.createDiv({ cls: "timer-stats-section-title", text: "近 7 天" });
    const barsWrap = weekSection.createDiv({ cls: "timer-stats-bars" });
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dateKeyOf(d);
      const minutes = (stats[key] || []).reduce((s, e) => s + e.m, 0);
      days.push({ key, minutes, label: `${d.getMonth() + 1}/${d.getDate()}` });
    }
    const maxM = Math.max(...days.map((x) => x.minutes), 1);
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const col = barsWrap.createDiv({ cls: "timer-stats-bar-col" });
      if (i === days.length - 1) col.addClass("is-today");
      const bar = col.createDiv({
        cls: "timer-stats-bar",
        attr: { title: `${day.key}：${this.plugin._statText(day.minutes)}` }
      });
      bar.style.height = `${Math.max(4, Math.round((day.minutes / maxM) * 100))}%`;
      col.createDiv({ cls: "timer-stats-bar-label", text: day.label });
    }

    let totalCount = 0;
    let totalMinutes = 0;
    const nowD = new Date();
    const monthKey = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, "0")}`;
    let monthCount = 0;
    let monthMinutes = 0;
    for (const key in stats) {
      for (const e of stats[key]) {
        totalCount++;
        totalMinutes += e.m;
        if (key.startsWith(monthKey)) {
          monthCount++;
          monthMinutes += e.m;
        }
      }
    }
    const totalSection = contentEl.createDiv({ cls: "timer-stats-section" });
    totalSection.createDiv({ cls: "timer-stats-section-title", text: "合计" });
    totalSection.createDiv({ cls: "timer-stats-total", text: `本月：${monthCount} 个番茄 · ${this.plugin._statText(monthMinutes)}` });
    totalSection.createDiv({ cls: "timer-stats-total", text: `累计：${totalCount} 个番茄 · ${this.plugin._statText(totalMinutes)}` });

    let confirmPending = false;
    const clearBtn = contentEl.createEl("button", { cls: "mod-warning", text: "清空统计" });
    clearBtn.addEventListener("click", async () => {
      if (!confirmPending) {
        confirmPending = true;
        clearBtn.setText("再点一次确认清空");
        return;
      }
      this.plugin.settings.dailyStats = {};
      await this.plugin.saveSettings();
      this.plugin.updateStatusBar();
      this.renderStatsTab();
    });
  }
  // ===== 日历 tab =====
  renderCalendarTab() {
    const contentEl = this.tabBody;
    const calSection = contentEl.createDiv({ cls: "timer-stats-section" });
    const calHeader = calSection.createDiv({ cls: "timer-cal-header" });
    const prevBtn = calHeader.createEl("button", { cls: "timer-cal-btn", attr: { "aria-label": "上个月" } });
    (0, import_obsidian.setIcon)(prevBtn, "chevron-left");
    prevBtn.addEventListener("click", () => this.navMonth(-1));
    this.monthLabel = calHeader.createSpan({ cls: "timer-cal-month" });
    const nextBtn = calHeader.createEl("button", { cls: "timer-cal-btn", attr: { "aria-label": "下个月" } });
    (0, import_obsidian.setIcon)(nextBtn, "chevron-right");
    nextBtn.addEventListener("click", () => this.navMonth(1));
    this.nextBtn = nextBtn;
    const todayBtn = calHeader.createEl("button", { cls: ["timer-cal-btn", "timer-cal-today-btn"], text: "本月" });
    todayBtn.addEventListener("click", () => {
      const now = new Date();
      this.viewYear = now.getFullYear();
      this.viewMonth = now.getMonth();
      this.renderCalendar();
    });
    this.calBody = calSection.createDiv({ cls: "timer-cal-body" });
    this.renderCalendar();
    const legend = contentEl.createDiv({ cls: "timer-cal-legend" });
    legend.createSpan({ text: "少" });
    for (let l = 0; l <= 4; l++) {
      legend.createDiv({ cls: "timer-cal-cell" + (l > 0 ? ` lvl${l}` : "") + " legend-cell" });
    }
    legend.createSpan({ text: "多" });
    legend.createDiv({ cls: "timer-cal-legend-note", text: "颜色深浅 = 番茄分钟 · 蓝点 = 当天有待办" });
    this.dayDetailEl = contentEl.createDiv({ cls: "timer-cal-detail" });
    if (this.selectedDate) this.renderDayDetail(this.selectedDate);
  }
  navMonth(delta) {
    const d = new Date(this.viewYear, this.viewMonth + delta, 1);
    this.viewYear = d.getFullYear();
    this.viewMonth = d.getMonth();
    this.renderCalendar();
  }
  renderCalendar() {
    const now = new Date();
    this.monthLabel.setText(`${this.viewYear}年${this.viewMonth + 1}月`);
    const isCurrent = this.viewYear === now.getFullYear() && this.viewMonth === now.getMonth();
    if (this.nextBtn) {
      if (isCurrent) this.nextBtn.setAttribute("disabled", "disabled");
      else this.nextBtn.removeAttribute("disabled");
    }
    this.calBody.empty();
    const stats = this.plugin.settings.dailyStats || {};
    const todos = this.plugin.settings.todos || [];
    const grid = this.calBody.createDiv({ cls: "timer-cal-grid" });
    for (const n of ["一", "二", "三", "四", "五", "六", "日"]) {
      grid.createDiv({ cls: "timer-cal-head", text: n });
    }
    const firstDay = new Date(this.viewYear, this.viewMonth, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
    for (let i = 0; i < offset; i++) grid.createDiv({ cls: "timer-cal-blank" });
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(this.viewYear, this.viewMonth, day);
      const key = dateKeyOf(d);
      const entries = stats[key] || [];
      const minutes = entries.reduce((s, e) => s + e.m, 0);
      const level = minutes <= 0 ? 0 : minutes < 60 ? 1 : minutes < 120 ? 2 : minutes < 180 ? 3 : 4;
      const hasTodos = todos.some((t) => t.date === key);
      const cell = grid.createDiv({
        cls: "timer-cal-cell"
          + (level > 0 ? ` lvl${level}` : "")
          + (d > now ? " is-future" : "")
          + (key === this.selectedDate ? " is-selected" : "")
          + (hasTodos || entries.length > 0 ? " is-clickable" : ""),
        attr: { title: `${key}：${entries.length} 个番茄 · ${minutes} 分钟${hasTodos ? " · 当天有待办" : ""}` }
      });
      cell.createSpan({ text: String(day) });
      if (hasTodos) cell.createDiv({ cls: "timer-cal-dot" });
      cell.addEventListener("click", () => this.selectDay(key));
    }
  }
  selectDay(key) {
    this.selectedDate = key;
    this.pendingDate = key;
    this.renderCalendar();
    if (this.dayDetailEl) this.renderDayDetail(key);
  }
  renderDayDetail(key) {
    this.dayDetailEl.empty();
    const stats = this.plugin.settings.dailyStats || {};
    const entries = stats[key] || [];
    const minutes = entries.reduce((s, e) => s + e.m, 0);
    const todos = (this.plugin.settings.todos || []).filter((t) => t.date === key);
    this.dayDetailEl.createDiv({ cls: "timer-cal-detail-title", text: `📅 ${key}` });
    this.dayDetailEl.createDiv({ cls: "timer-cal-detail-info", text: `番茄 ${entries.length} 个 · ${minutes} 分钟` });
    if (this.pendingDate === key) {
      this.dayDetailEl.createDiv({ cls: "timer-cal-detail-hint", text: "已设为待办添加日期，待办页添加栏会自动带这一天" });
    }
    if (todos.length === 0) {
      this.dayDetailEl.createDiv({ cls: "timer-cal-detail-empty", text: "当天没有待办" });
    }
    for (const t of todos) {
      const row = this.dayDetailEl.createDiv({ cls: "timer-todo-item" + (t.done ? " is-done" : "") });
      const cb = row.createEl("input", { cls: "timer-todo-checkbox", type: "checkbox" });
      cb.checked = t.done;
      cb.addEventListener("change", () => { this.plugin.toggleTodo(t.id); this.renderDayDetail(key); });
      row.createEl("span", { cls: "timer-todo-text", text: t.text });
      const delBtn = row.createEl("button", { cls: "timer-todo-del", attr: { "aria-label": "删除" } });
      (0, import_obsidian.setIcon)(delBtn, "x");
      delBtn.addEventListener("click", () => { this.plugin.removeTodo(t.id); this.renderDayDetail(key); });
    }
  }
  makeDraggable() {
    const modal = this.modalEl;
    const handle = modal.querySelector(".modal-header");
    if (!handle) return;
    handle.addClass("timer-panel-drag-handle");
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button, .clickable-icon, input")) return;
      e.preventDefault();
      const rect = modal.getBoundingClientRect();
      modal.style.position = "fixed";
      modal.style.left = rect.left + "px";
      modal.style.top = rect.top + "px";
      modal.style.margin = "0";
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      const onMove = (ev) => {
        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;
        modal.style.left = Math.max(0, Math.min(ev.clientX - offsetX, maxX)) + "px";
        modal.style.top = Math.max(0, Math.min(ev.clientY - offsetY, maxY)) + "px";
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }
  onClose() {
    this.contentEl.empty();
    this.plugin.panelModal = null;
  }
};
var TimerSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("\u5012\u8BA1\u65F6\u65F6\u95F4 (\u5206\u949F)").setDesc("\u8BBE\u7F6E\u5012\u8BA1\u65F6\u7684\u65F6\u957F\uFF0C\u70B9\u51FB\u4FA7\u8FB9\u680F\u56FE\u6807\u5C06\u4EE5\u6B64\u65F6\u95F4\u5F00\u59CB\u3002").addText((text) => {
      text.setPlaceholder("\u5982: 20");
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.setValue(this.plugin.settings.durationMinutes.toString()).onChange(async (value) => {
        const parsed = Number(value);
        if (!isNaN(parsed) && parsed > 0) {
          this.plugin.settings.durationMinutes = parsed;
          await this.plugin.saveSettings();
        }
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u4F11\u606F\u65F6\u957F (\u5206\u949F)").setDesc("\u756A\u8304\u719F\u4E86\u4E4B\u540E\uFF0C\u70B9\u51FB\u63D0\u793A\u6587\u5B57\u5F00\u59CB\u4F11\u606F\u5012\u8BA1\u65F6\u7684\u957F\u5EA6\u3002").addText((text) => {
      text.setPlaceholder("\u5982: 5");
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.setValue(this.plugin.settings.breakMinutes.toString()).onChange(async (value) => {
        const parsed = Number(value);
        if (!isNaN(parsed) && parsed > 0) {
          this.plugin.settings.breakMinutes = parsed;
          await this.plugin.saveSettings();
        }
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u4F11\u606F\u7ED3\u675F\u63D0\u793A").setDesc("\u4F11\u606F\u5012\u8BA1\u65F6\u7ED3\u675F\u65F6\uFF0C\u60AC\u6D6E\u7A97\u4E2D\u663E\u793A\u7684\u6587\u5B57\uFF08\u70B9\u51FB\u5B83\u4F1A\u5F00\u59CB\u65B0\u4E00\u8F6E\u5DE5\u4F5C\uFF09\u3002").addText((text) => text.setPlaceholder("\u5982\uFF1A\u4F11\u606F\u7ED3\u675F\uFF0C\u7EE7\u7EED\u52A0\u6CB9\uFF01").setValue(this.plugin.settings.breakMessage).onChange(async (value) => {
      this.plugin.settings.breakMessage = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u63D0\u793A\u5185\u5BB9").setDesc("\u5012\u8BA1\u65F6\u7ED3\u675F\u65F6\uFF0C\u60AC\u6D6E\u7A97\u4E2D\u663E\u793A\u7684\u6587\u5B57\u3002").addText((text) => text.setPlaceholder("\u5982\uFF1A\u8BE5\u559D\u6C34\u4E86\uFF01").setValue(this.plugin.settings.message).onChange(async (value) => {
      this.plugin.settings.message = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u5F00\u542F\u8F6F\u4EF6\u65F6\u81EA\u52A8\u542F\u52A8").setDesc("\u5F00\u542F\u540E\uFF0C\u6BCF\u6B21\u6253\u5F00 Obsidian \u65F6\uFF0C\u5982\u679C\u6CA1\u6709\u672A\u5B8C\u6210\u6216\u672A\u63D0\u9192\u7684\u5012\u8BA1\u65F6\u4EFB\u52A1\uFF0C\u5219\u4F1A\u81EA\u52A8\u5F00\u59CB\u65B0\u7684\u4E00\u8F6E\u5012\u8BA1\u65F6\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoStartOnLaunch).onChange(async (value) => {
        this.plugin.settings.autoStartOnLaunch = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5012\u8BA1\u65F6\u6A21\u5F0F").setDesc("\u3010\u771F\u5B9E\u65F6\u95F4\u3011\uFF1A\u8F6F\u4EF6\u5173\u95ED\u6216\u7535\u8111\u4F11\u7720\u65F6\u65F6\u95F4\u7EE7\u7EED\u6D41\u901D\uFF1B\u3010\u4EC5\u8F6F\u4EF6\u8FD0\u884C\u3011\uFF1A\u5173\u95ED\u6216\u4F11\u7720\u65F6\u5012\u6570\u6682\u505C\uFF08\u9002\u5408\u9632\u7528\u773C\u8FC7\u5EA6\uFF09\u3002").addDropdown(
      (drop) => drop.addOption("real", "\u6309\u771F\u5B9E\u65F6\u95F4\u6D41\u901D (\u559D\u6C34/\u756A\u8304\u949F)").addOption("app", "\u4EC5\u8F6F\u4EF6\u8FD0\u884C\u65F6\u5012\u6570 (\u9632\u75B2\u52B3\u6C89\u6D78)").setValue(this.plugin.settings.countMode).onChange(async (value) => {
        this.plugin.settings.countMode = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u663E\u793A\u72B6\u6001\u680F\u5012\u8BA1\u65F6").setDesc("\u5F00\u542F\u540E\uFF0C\u4F1A\u5728\u8F6F\u4EF6\u5E95\u90E8\u72B6\u6001\u680F\u5B9E\u65F6\u663E\u793A\u5269\u4F59\u7684\u5012\u8BA1\u65F6\u65F6\u95F4\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
      this.plugin.settings.showStatusBar = value;
      await this.plugin.saveSettings();
      this.plugin.updateStatusBar();
    }));
    new import_obsidian.Setting(containerEl).setName("\u6DF1\u8272\u6A21\u5F0F\u80CC\u666F\u8272").setDesc("\u8BBE\u7F6E\u6DF1\u8272\u6A21\u5F0F\u4E0B\u80F6\u56CA\u60AC\u6D6E\u7A97\u7684\u80CC\u666F\u989C\u8272\u3002").addColorPicker(
      (color) => color.setValue(this.plugin.settings.darkBgColor).onChange(async (value) => {
        this.plugin.settings.darkBgColor = value;
        await this.plugin.saveSettings();
        this.plugin.applyCustomStyles();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u6D45\u8272\u6A21\u5F0F\u80CC\u666F\u8272").setDesc("\u8BBE\u7F6E\u6D45\u8272\u6A21\u5F0F\u4E0B\u80F6\u56CA\u60AC\u6D6E\u7A97\u7684\u80CC\u666F\u989C\u8272\u3002").addColorPicker(
      (color) => color.setValue(this.plugin.settings.lightBgColor).onChange(async (value) => {
        this.plugin.settings.lightBgColor = value;
        await this.plugin.saveSettings();
        this.plugin.applyCustomStyles();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u8C46\u6D46\u9762\u677F").setDesc("\u4E09\u4E2A\u5207\u6362\u754C\u9762\uFF1A\u5F85\u529E / \u7EDF\u8BA1 / \u65E5\u5386\uFF0C\u4E5F\u53EF\u70B9\u51FB\u5E95\u90E8\u72B6\u6001\u680F\u6253\u5F00\u3002").addButton((btn) => btn.setButtonText("\u6253\u5F00\u9762\u677F").onClick(() => this.plugin.openPanel("stats")));
  }
};

/* nosourcemap */