  (() => {
    "use strict";

    const STORAGE_KEY = "jiuzhoubao_revenue_v1";
    const APP_VERSION = 1;
    const CHANNELS = [
      { id: "mini", name: "小程序", mark: "小", promo: false },
      { id: "pos", name: "卡机", mark: "卡", promo: false },
      { id: "taobao", name: "淘宝闪购", mark: "淘", promo: true },
      { id: "meituan", name: "美团", mark: "美", promo: true }
    ];
    const EXPENSES = [
      { id: "rent", name: "房租" },
      { id: "labor", name: "人工" },
      { id: "utilities", name: "水电" },
      { id: "other", name: "其他" }
    ];
    const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const moneyFormatter = new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    let storageAvailable = true;
    let state = loadState();
    let currentView = "entry";
    let entry = null;
    let entryDirty = false;
    let toastTimer = 0;

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function freshChannels() {
      return Object.fromEntries(CHANNELS.map(channel => [channel.id, { rate: 0, fixedFee: 0 }]));
    }

    function freshExpenses() {
      return Object.fromEntries(EXPENSES.map(expense => [expense.id, 0]));
    }

    function freshState() {
      return {
        version: APP_VERSION,
        settings: {
          storeName: "九州堡营收管家",
          configured: false,
          channels: freshChannels(),
          expenses: freshExpenses()
        },
        records: {}
      };
    }

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function clampNumber(value, min = 0, max = 999999999) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return min;
      return Math.min(max, Math.max(min, parsed));
    }

    function round2(value) {
      return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    }

    function formatMoney(value) {
      const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
      return moneyFormatter.format(amount);
    }

    function formatNumber(value, digits = 2) {
      const number = Number(value) || 0;
      return number.toLocaleString("zh-CN", {
        minimumFractionDigits: Number.isInteger(number) ? 0 : digits,
        maximumFractionDigits: digits
      });
    }

    function formatPercent(value) {
      const number = Number(value) || 0;
      return `${number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;
    }

    function localDateString(date = new Date()) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    function parseLocalDate(dateString) {
      const parts = String(dateString || "").split("-").map(Number);
      if (parts.length !== 3 || !parts.every(Number.isFinite)) return new Date();
      return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
    }

    function shiftDate(dateString, days) {
      const date = parseLocalDate(dateString);
      date.setDate(date.getDate() + days);
      return localDateString(date);
    }

    function dateLabel(dateString) {
      const date = parseLocalDate(dateString);
      const today = localDateString();
      const prefix = dateString === today ? "今天 · " : "";
      return `${prefix}${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
    }

    function shortDateLabel(dateString) {
      const date = parseLocalDate(dateString);
      return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
    }

    function normalizeChannelConfig(raw) {
      return {
        rate: clampNumber(raw?.rate, 0, 100),
        fixedFee: clampNumber(raw?.fixedFee, 0, 999999999)
      };
    }

    function normalizeExpenses(raw) {
      return Object.fromEntries(EXPENSES.map(expense => [
        expense.id,
        clampNumber(raw?.[expense.id], 0, 999999999)
      ]));
    }

    function normalizeChannels(raw) {
      return Object.fromEntries(CHANNELS.map(channel => {
        const item = raw?.[channel.id] || {};
        return [channel.id, {
          gross: clampNumber(item.gross, 0, 999999999),
          promotion: channel.promo ? clampNumber(item.promotion, 0, 999999999) : 0
        }];
      }));
    }

    function normalizeConfig(raw, fallback = null) {
      const source = raw?.channels ? raw : fallback;
      return {
        channels: Object.fromEntries(CHANNELS.map(channel => [
          channel.id,
          normalizeChannelConfig(source?.channels?.[channel.id])
        ]))
      };
    }

    function normalizeRecord(raw, date) {
      return {
        date,
        channels: normalizeChannels(raw?.channels),
        expenses: normalizeExpenses(raw?.expenses),
        note: String(raw?.note || "").slice(0, 300),
        config: raw?.config ? normalizeConfig(raw.config) : null,
        updatedAt: String(raw?.updatedAt || "")
      };
    }

    function normalizeState(input) {
      const base = freshState();
      if (!input || typeof input !== "object") return base;
      const source = input.state && typeof input.state === "object" ? input.state : input;
      const settings = source.settings || {};
      base.settings.storeName = String(settings.storeName || base.settings.storeName).slice(0, 24);
      base.settings.configured = Boolean(settings.configured);
      base.settings.channels = Object.fromEntries(CHANNELS.map(channel => [
        channel.id,
        normalizeChannelConfig(settings.channels?.[channel.id])
      ]));
      base.settings.expenses = normalizeExpenses(settings.expenses);
      if (source.records && typeof source.records === "object") {
        Object.entries(source.records).forEach(([date, raw]) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(date)) base.records[date] = normalizeRecord(raw, date);
        });
      }
      return base;
    }

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? normalizeState(JSON.parse(raw)) : freshState();
      } catch (error) {
        storageAvailable = false;
        return freshState();
      }
    }

    function persistState() {
      if (!storageAvailable) return false;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch (error) {
        storageAvailable = false;
        showToast("浏览器存储不可用，数据暂时无法保存");
        return false;
      }
    }

    function snapshotConfig() {
      return normalizeConfig({ channels: clone(state.settings.channels) });
    }

    function configForRecord(record) {
      return record?.config?.channels ? record.config : snapshotConfig();
    }

    function createBlankRecord(date) {
      return {
        date,
        channels: Object.fromEntries(CHANNELS.map(channel => [channel.id, { gross: 0, promotion: 0 }])),
        expenses: clone(state.settings.expenses),
        note: "",
        config: snapshotConfig(),
        updatedAt: ""
      };
    }

    function calculate(record) {
      const config = configForRecord(record);
      let gross = 0;
      let fees = 0;
      let promotion = 0;
      let platformNet = 0;
      const channels = {};

      CHANNELS.forEach(channel => {
        const channelRecord = record?.channels?.[channel.id] || { gross: 0, promotion: 0 };
        const channelConfig = config.channels[channel.id] || { rate: 0, fixedFee: 0 };
        const channelGross = round2(clampNumber(channelRecord.gross));
        const channelPromotion = channel.promo ? round2(clampNumber(channelRecord.promotion)) : 0;
        const channelFee = channelGross > 0
          ? round2(channelGross * channelConfig.rate / 100 + channelConfig.fixedFee)
          : 0;
        const channelNet = round2(channelGross - channelFee - channelPromotion);
        gross += channelGross;
        fees += channelFee;
        promotion += channelPromotion;
        platformNet += channelNet;
        channels[channel.id] = {
          gross: channelGross,
          promotion: channelPromotion,
          fee: channelFee,
          net: channelNet
        };
      });

      const expenses = Object.fromEntries(EXPENSES.map(expense => [
        expense.id,
        round2(clampNumber(record?.expenses?.[expense.id]))
      ]));
      const expenseTotal = round2(Object.values(expenses).reduce((sum, value) => sum + value, 0));
      gross = round2(gross);
      fees = round2(fees);
      promotion = round2(promotion);
      platformNet = round2(platformNet);
      const profit = round2(platformNet - expenseTotal);
      const margin = gross > 0 ? round2(profit / gross * 100) : 0;

      return {
        gross,
        fees,
        promotion,
        platformNet,
        expenses,
        expenseTotal,
        profit,
        margin,
        channels,
        totalDeductions: round2(fees + promotion + expenseTotal)
      };
    }

    function renderChannelForm() {
      const list = $("#channelList");
      list.innerHTML = CHANNELS.map(channel => `
        <div class="channel-block" data-channel="${channel.id}">
          <div class="channel-top">
            <div class="channel-name"><span class="channel-symbol" aria-hidden="true">${channel.mark}</span>${channel.name}</div>
            <span class="rate-chip" id="rateChip-${channel.id}">扣点 0%</span>
          </div>
          <div class="money-row${channel.promo ? "" : " single"}">
            <label class="field">
              <span>营业收入</span>
              <input class="money-input channel-income" id="income-${channel.id}" data-channel="${channel.id}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" aria-label="${channel.name}营业收入">
            </label>
            ${channel.promo ? `
            <label class="field">
              <span>当天推广费</span>
              <input class="money-input channel-promotion" id="promotion-${channel.id}" data-channel="${channel.id}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" aria-label="${channel.name}推广费">
            </label>` : ""}
          </div>
          <div class="channel-meta">
            <span id="channelFee-${channel.id}">扣点 ¥0.00</span>
            <span>平台到账 <b id="channelNet-${channel.id}">¥0.00</b></span>
          </div>
        </div>
      `).join("");
    }

    function renderChannelSettings() {
      const container = $("#channelSettings");
      container.innerHTML = CHANNELS.map(channel => `
        <div class="setting-row">
          <div class="setting-name">${channel.name}<small>${channel.promo ? "支持每日推广费" : "按营业额比例扣点"}</small></div>
          <label class="unit-input">
            <span class="sr-only">${channel.name}扣点比例</span>
            <input class="setting-input setting-rate" id="setting-rate-${channel.id}" data-channel="${channel.id}" type="number" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0">
            <em>%</em>
          </label>
          <label class="unit-input">
            <span class="sr-only">${channel.name}每日固定扣费</span>
            <input class="setting-input setting-fixed" id="setting-fixed-${channel.id}" data-channel="${channel.id}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0">
            <em>元/日</em>
          </label>
        </div>
      `).join("");
    }    function populateEntryForm(record) {
      CHANNELS.forEach(channel => {
        const incomeInput = $(`#income-${channel.id}`);
        const promotionInput = $(`#promotion-${channel.id}`);
        const channelRecord = record.channels?.[channel.id] || { gross: 0, promotion: 0 };
        if (incomeInput) incomeInput.value = channelRecord.gross ? channelRecord.gross : "";
