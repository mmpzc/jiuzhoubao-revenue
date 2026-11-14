        if (promotionInput) promotionInput.value = channelRecord.promotion ? channelRecord.promotion : "";
      });
      EXPENSES.forEach(expense => {
        const input = $(`#expense${expense.id.charAt(0).toUpperCase()}${expense.id.slice(1)}`);
        if (input) input.value = record.expenses?.[expense.id] ? record.expenses[expense.id] : "";
      });
      $("#entryNote").value = record.note || "";
    }

    function readEntryDraft() {
      const record = {
        date: entry.date,
        channels: {},
        expenses: {},
        note: $("#entryNote").value.slice(0, 300),
        config: entry.record?.config ? clone(entry.record.config) : snapshotConfig(),
        updatedAt: entry.record?.updatedAt || ""
      };
      CHANNELS.forEach(channel => {
        const grossInput = $(`#income-${channel.id}`);
        const promoInput = $(`#promotion-${channel.id}`);
        record.channels[channel.id] = {
          gross: clampNumber(grossInput?.value, 0, 999999999),
          promotion: channel.promo ? clampNumber(promoInput?.value, 0, 999999999) : 0
        };
      });
      EXPENSES.forEach(expense => {
        const input = $(`#expense${expense.id.charAt(0).toUpperCase()}${expense.id.slice(1)}`);
        record.expenses[expense.id] = clampNumber(input?.value, 0, 999999999);
      });
      return record;
    }

    function setText(id, value) {
      const element = $(`#${id}`);
      if (element) element.textContent = value;
    }

    function setSignedMoney(id, value) {
      const element = $(`#${id}`);
      if (!element) return;
      element.textContent = value > 0 ? `- ${formatMoney(value)}` : formatMoney(0);
      element.classList.toggle("negative", value > 0);
    }

    function updateEntryView() {
      if (!entry) return;
      const draft = readEntryDraft();
      const result = calculate(draft);
      const config = configForRecord(draft);

      CHANNELS.forEach(channel => {
        const channelResult = result.channels[channel.id];
        const channelConfig = config.channels[channel.id];
        const rateText = `扣点 ${formatPercent(channelConfig.rate)}${channelConfig.fixedFee > 0 ? ` + ${formatMoney(channelConfig.fixedFee)}/日` : ""}`;
        setText(`rateChip-${channel.id}`, rateText);
        setText(`channelFee-${channel.id}`, `扣点 ${formatMoney(channelResult.fee)}`);
        setText(`channelNet-${channel.id}`, formatMoney(channelResult.net));
      });

      setSignedMoney("summaryFees", result.fees);
      setSignedMoney("summaryPromo", result.promotion);
      setText("summaryNet", formatMoney(result.platformNet));
      setSignedMoney("summaryExpenses", result.expenseTotal);
      const summaryProfit = $("#summaryProfit");
      summaryProfit.textContent = formatMoney(result.profit);
      summaryProfit.classList.toggle("positive", result.profit > 0);
      summaryProfit.classList.toggle("negative", result.profit < 0);

      setText("heroProfit", formatMoney(result.profit));
      setText("heroGross", formatMoney(result.gross));
      setText("heroNet", formatMoney(result.platformNet));
      setText("heroExpense", formatMoney(result.expenseTotal + result.fees + result.promotion));
      setText("heroMargin", formatPercent(result.margin));
      setText("heroDate", dateLabel(entry.date));
      const existing = Boolean(state.records[entry.date]);
      setText("heroStatus", entryDirty ? "有未保存修改" : existing ? "记录已保存" : "尚未保存");
      setText("headerChip", entry.date === localDateString() ? "今日经营" : "历史补记");
      $("#configWarning").hidden = state.settings.configured;

      EXPENSES.forEach(expense => {
        setText(`${expense.id}Hint`, `默认 ${formatMoney(state.settings.expenses[expense.id])}`);
      });

      const deleteButton = $("#deleteEntryButton");
      if (deleteButton) deleteButton.hidden = !existing;
      setText("saveEntryButton", existing ? "更新记录" : "保存记录");
    }

    function prepareEntry(date) {
      const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDateString();
      const loaded = state.records[normalizedDate]
        ? normalizeRecord(state.records[normalizedDate], normalizedDate)
        : createBlankRecord(normalizedDate);
      if (!loaded.config) loaded.config = snapshotConfig();
      entry = {
        date: normalizedDate,
        record: clone(loaded)
      };
      $("#entryDate").value = normalizedDate;
      populateEntryForm(entry.record);
      entryDirty = false;
      updateEntryView();
    }

    function requestDateChange(date) {
      if (!date || !entry || date === entry.date) return;
      if (entryDirty && !window.confirm("当前日期有未保存的修改，确定切换吗？")) {
        $("#entryDate").value = entry.date;
        return;
      }
      prepareEntry(date);
    }

    function saveEntry() {
      const draft = readEntryDraft();
      const result = calculate(draft);
      const hasData = result.gross > 0
        || result.promotion > 0
        || result.expenseTotal > 0
        || draft.note.trim().length > 0;
      if (!hasData) {
        showToast("请先填写营业额、费用或备注");
        return;
      }
      if (!state.settings.configured && !window.confirm("渠道扣点还没有确认，当前按 0% 保存。仍要保存这条记录吗？")) {
        return;
      }
      draft.updatedAt = new Date().toISOString();
      state.records[entry.date] = draft;
      entry.record = clone(draft);
      entryDirty = false;
      const stored = persistState();
      updateEntryView();
      renderHistory();
      showToast(stored ? "当日记录已保存" : "记录已保存在当前页面，刷新后会丢失");
    }

    function deleteEntry() {
      if (!state.records[entry.date]) return;
      if (!window.confirm(`确定删除 ${shortDateLabel(entry.date)} 的记录吗？删除后无法恢复。`)) return;
      delete state.records[entry.date];
      persistState();
      prepareEntry(entry.date);
      renderHistory();
      showToast("当日记录已删除");
    }

    function showView(view) {
      currentView = view;
      $$(".view").forEach(section => {
        section.hidden = section.id !== `view-${view}`;
      });
      $$(".nav-button").forEach(button => {
        button.classList.toggle("active", button.dataset.view === view);
      });
      if (view === "history") renderHistory();
      if (view === "settings") renderSettingsForm();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function aggregateRecords(records) {
      return records.reduce((total, record) => {
        const result = calculate(record);
        total.gross += result.gross;
        total.platformNet += result.platformNet;
        total.expenseTotal += result.expenseTotal;
        total.profit += result.profit;
        return total;
      }, { gross: 0, platformNet: 0, expenseTotal: 0, profit: 0 });
    }

    function recordsForMonth(month) {
      return Object.keys(state.records)
        .filter(date => date.startsWith(month))
        .sort()
        .map(date => state.records[date]);
    }

    function renderHistory() {
      const month = $("#monthPicker").value || localDateString().slice(0, 7);
      const records = recordsForMonth(month);
      const totals = aggregateRecords(records);
      setText("monthGross", formatMoney(totals.gross));
      setText("monthNet", formatMoney(totals.platformNet));
      setText("monthExpense", formatMoney(totals.expenseTotal));
      const monthProfit = $("#monthProfit");
      monthProfit.textContent = formatMoney(totals.profit);
      monthProfit.classList.toggle("positive", totals.profit > 0);
      monthProfit.classList.toggle("negative", totals.profit < 0);
      setText("historyCount", records.length ? `本月已记录 ${records.length} 天` : "本月暂无记录");

      const list = $("#historyList");
      if (!records.length) {
        list.innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">◷</span>这个月份还没有记录<br>回到“记账”页面添加第一条</div>`;
        return;
      }

      list.innerHTML = records.slice().reverse().map(record => {
        const result = calculate(record);
        const date = parseLocalDate(record.date);
        return `
          <button class="history-row" type="button" data-date="${record.date}">
            <span class="history-date"><strong>${date.getDate()}</strong><span>${WEEKDAYS[date.getDay()]}</span></span>
            <span class="history-main">
              <strong>营业额 ${formatMoney(result.gross)}</strong>
              <span>平台到账 ${formatMoney(result.platformNet)} · 费用 ${formatMoney(result.expenseTotal)}</span>
            </span>
            <span class="history-profit">
              <b class="${result.profit > 0 ? "positive" : result.profit < 0 ? "negative" : ""}">${formatMoney(result.profit)}</b>
              <span>净利率 ${formatPercent(result.margin)}</span>
            </span>
          </button>
        `;
      }).join("");
    }

    function renderSettingsForm() {
      $("#settingStoreName").value = state.settings.storeName;
      CHANNELS.forEach(channel => {
        const config = state.settings.channels[channel.id];
        $(`#setting-rate-${channel.id}`).value = config.rate || "";
        $(`#setting-fixed-${channel.id}`).value = config.fixedFee || "";
      });
      EXPENSES.forEach(expense => {
        const input = $(`#setting${expense.id.charAt(0).toUpperCase()}${expense.id.slice(1)}`);
        if (input) input.value = state.settings.expenses[expense.id] || "";
      });
    }

    function saveSettings() {
      const name = $("#settingStoreName").value.trim() || "九州堡营收管家";
      state.settings.storeName = name.slice(0, 24);
      state.settings.channels = Object.fromEntries(CHANNELS.map(channel => [
        channel.id,
        {
          rate: clampNumber($(`#setting-rate-${channel.id}`).value, 0, 100),
          fixedFee: clampNumber($(`#setting-fixed-${channel.id}`).value, 0, 999999999)
        }
      ]));
      state.settings.expenses = Object.fromEntries(EXPENSES.map(expense => [
        expense.id,
        clampNumber($(`#setting${expense.id.charAt(0).toUpperCase()}${expense.id.slice(1)}`).value, 0, 999999999)
      ]));
      state.settings.configured = true;
      persistState();
      updateStoreIdentity();

      if (entry && !state.records[entry.date] && !entryDirty) {
        prepareEntry(entry.date);
      } else if (entry && !state.records[entry.date]) {
        entry.record.config = snapshotConfig();
        updateEntryView();
      } else if (entry) {
        updateEntryView();
      }
      renderHistory();
      showToast("扣点与每日费用已保存，新记录将使用此设置");
    }

    function updateStoreIdentity() {
      setText("storeTitle", state.settings.storeName);
      document.title = `${state.settings.storeName} · 营收管家`;
    }

    function showToast(message) {
      const toast = $("#toast");
      toast.textContent = message;
      toast.classList.add("show");
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2400);
    }    function csvText(value) {
      let text = String(value ?? "");
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    }

    function csvNumber(value) {
      return round2(clampNumber(value)).toFixed(2);
    }

    function buildCsv(records) {
      const headers = [
        "日期",
        ...CHANNELS.map(channel => `${channel.name}营业额`),
        "淘宝闪购推广费",
        "美团推广费",
        "平台扣点",
        "推广费合计",
        "平台到账",
        "房租",
        "人工",
        "水电",
        "其他费用",
        "经营费用合计",
        "经营净利",
        "净利率(%)",
        "备注"
      ];
      const rows = records
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(record => {
          const result = calculate(record);
          return [
            record.date,
            ...CHANNELS.map(channel => csvNumber(result.channels[channel.id].gross)),
            csvNumber(result.channels.taobao.promotion),
            csvNumber(result.channels.meituan.promotion),
            csvNumber(result.fees),
            csvNumber(result.promotion),
            csvNumber(result.platformNet),
