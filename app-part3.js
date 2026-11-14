            ...EXPENSES.map(expense => csvNumber(result.expenses[expense.id])),
            csvNumber(result.expenseTotal),
            csvNumber(result.profit),
            csvNumber(result.margin),
            csvText(record.note || "")
          ].join(",");
        });
      return `\ufeff${headers.map(csvText).join(",")}\r\n${rows.join("\r\n")}`;
    }

    function downloadText(filename, content, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportCsv(records, label) {
      if (!records.length) {
        showToast("暂无可导出的记录");
        return;
      }
      const filename = `九州堡营收明细-${label || "全部"}.csv`;
      downloadText(filename, buildCsv(records), "text/csv;charset=utf-8");
      showToast("CSV 明细已导出");
    }

    function exportBackup() {
      const payload = {
        app: "jiuzhoubao-revenue",
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        state: clone(state)
      };
      downloadText(
        `九州堡营收备份-${localDateString()}.json`,
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8"
      );
      showToast("完整备份已导出");
    }

    async function importBackup(file) {
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const source = parsed.state && typeof parsed.state === "object" ? parsed.state : parsed;
        if (!source || typeof source !== "object" || (!source.settings && !source.records)) {
          throw new Error("invalid");
        }
        if (!window.confirm("导入备份会覆盖当前全部数据，确定继续吗？")) return;
        state = normalizeState(parsed);
        storageAvailable = true;
        persistState();
        updateStoreIdentity();
        renderSettingsForm();
        prepareEntry(state.records[localDateString()] ? localDateString() : Object.keys(state.records).sort().pop() || localDateString());
        $("#monthPicker").value = entry.date.slice(0, 7);
        renderHistory();
        showView("entry");
        showToast("备份已导入");
      } catch (error) {
        showToast("备份文件无法读取，请确认是本应用导出的 JSON");
      }
    }

    function clearAllData() {
      if (!window.confirm("确定清空全部营收记录和设置吗？此操作无法撤销，建议先导出备份。")) return;
      state = freshState();
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        storageAvailable = false;
      }
      updateStoreIdentity();
      renderSettingsForm();
      const today = localDateString();
      $("#monthPicker").value = today.slice(0, 7);
      prepareEntry(today);
      renderHistory();
      showView("entry");
      showToast("全部数据已清空");
    }

    function fallbackCopy(text) {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, area.value.length);
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (error) {
        copied = false;
      }
      area.remove();
      return copied;
    }

    async function copyDailyReport() {
      const draft = readEntryDraft();
      const result = calculate(draft);
      const channelLines = CHANNELS
        .map(channel => {
          const item = result.channels[channel.id];
          const promotion = channel.promo ? `，推广 ${formatMoney(item.promotion)}` : "";
          return `${channel.name}：${formatMoney(item.gross)}${promotion}，扣点 ${formatMoney(item.fee)}`;
        })
        .join("\n");
      const report = [
        `${state.settings.storeName}`,
        `${shortDateLabel(entry.date)} 经营日报`,
        `营业额：${formatMoney(result.gross)}`,
        channelLines,
        `平台扣点：${formatMoney(result.fees)}`,
        `推广费：${formatMoney(result.promotion)}`,
        `平台到账：${formatMoney(result.platformNet)}`,
        `经营费用：${formatMoney(result.expenseTotal)}`,
        `经营净利：${formatMoney(result.profit)}（净利率 ${formatPercent(result.margin)}）`,
        draft.note.trim() ? `备注：${draft.note.trim()}` : ""
      ].filter(Boolean).join("\n");

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(report);
        } else if (!fallbackCopy(report)) {
          throw new Error("copy failed");
        }
        showToast("日报已复制，可直接粘贴到微信");
      } catch (error) {
        showToast("复制失败，请长按页面内容手动复制");
      }
    }

    function bindEvents() {
      $$(".nav-button").forEach(button => {
        button.addEventListener("click", () => showView(button.dataset.view));
      });
      $("#prevDate").addEventListener("click", () => requestDateChange(shiftDate(entry.date, -1)));
      $("#nextDate").addEventListener("click", () => requestDateChange(shiftDate(entry.date, 1)));
      $("#goToday").addEventListener("click", () => requestDateChange(localDateString()));
      $("#entryDate").addEventListener("change", event => requestDateChange(event.target.value));
      $("#saveEntryButton").addEventListener("click", saveEntry);
      $("#copyDailyButton").addEventListener("click", copyDailyReport);
      $("#deleteEntryButton")?.addEventListener("click", deleteEntry);
      $("#goSettingsFromNotice").addEventListener("click", () => showView("settings"));
      $("#saveSettingsButton").addEventListener("click", saveSettings);
      $("#monthPicker").addEventListener("change", renderHistory);
      $("#exportMonthButton").addEventListener("click", () => {
        const month = $("#monthPicker").value || localDateString().slice(0, 7);
        exportCsv(recordsForMonth(month), month);
      });
      $("#exportAllCsvButton").addEventListener("click", () => {
        exportCsv(Object.keys(state.records).sort().map(date => state.records[date]), "全部");
      });
      $("#exportBackupButton").addEventListener("click", exportBackup);
      $("#importBackupButton").addEventListener("click", () => $("#importFile").click());
      $("#importFile").addEventListener("change", async event => {
        await importBackup(event.target.files?.[0]);
        event.target.value = "";
      });
      $("#clearAllButton").addEventListener("click", clearAllData);
      $("#channelList").addEventListener("input", () => {
        entryDirty = true;
        updateEntryView();
      });
      ["rent", "labor", "utilities", "other"].forEach(id => {
        $(`#expense${id.charAt(0).toUpperCase()}${id.slice(1)}`).addEventListener("input", () => {
          entryDirty = true;
          updateEntryView();
        });
      });
      $("#entryNote").addEventListener("input", () => {
        entryDirty = true;
        updateEntryView();
      });
      $("#historyList").addEventListener("click", event => {
        const row = event.target.closest("[data-date]");
        if (!row) return;
        const date = row.dataset.date;
        if (entryDirty && !window.confirm("当前日期有未保存的修改，确定切换吗？")) return;
        prepareEntry(date);
        showView("entry");
      });
      window.addEventListener("beforeunload", event => {
        if (!entryDirty) return;
        event.preventDefault();
        event.returnValue = "";
      });
    }

    function registerServiceWorker() {
      if (!("serviceWorker" in navigator) || !/^https?:$/.test(window.location.protocol)) return;
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }

    function init() {
      renderChannelForm();
      renderChannelSettings();
      bindEvents();
      updateStoreIdentity();
      const today = localDateString();
      $("#monthPicker").value = today.slice(0, 7);
      $("#entryDate").value = today;
      prepareEntry(today);
      renderSettingsForm();
      renderHistory();
      showView("entry");
      registerServiceWorker();
      if (!storageAvailable) {
        showToast("当前浏览器禁止本地存储，请检查隐私设置");
      }
    }

    window.__JZB__ = {
      calculate,
      createBlankRecord: date => createBlankRecord(date || localDateString()),
      normalizeState,
      getState: () => clone(state),
      formatMoney,
      localDateString
    };

    init();
  })();
