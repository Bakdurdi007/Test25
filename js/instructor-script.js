const SUPABASE_URL = 'https://sqgdmanmnvioijducopi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxZ2RtYW5tbnZpb2lqZHVjb3BpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4Nzk1ODUsImV4cCI6MjA4NjQ1NTU4NX0.CmP9-bQaxQDAOKnVAlU4tkpRHmFlfXVEW2-tYJ52R90';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const html5QrCode = new Html5Qrcode("reader");

let currentStudent = null;
let isScanning = true;
let activeTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    updateInstStats();
    initScanner();
    loadClientList();
    syncActiveLesson();
    watchStatusChanges();
});

function checkSession() {
    const sessionStr = localStorage.getItem('inst_session');
    if (!sessionStr) {
        window.location.replace('index.html');
        return;
    }
    const session = JSON.parse(sessionStr);
    const nameEl = document.getElementById('inst-name');
    if (nameEl) nameEl.innerText = session.full_name;
}

function playSound(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        if (type === 'warning') {
            osc.frequency.value = 440;
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
            osc.start();
            osc.stop(ctx.currentTime + 0.8);
        } else if (type === 'finish') {
            osc.frequency.value = 580;
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 3);
            osc.start();
            osc.stop(ctx.currentTime + 3);
        }
    } catch (e) { console.error("Audio xatosi:", e); }
}

async function syncActiveLesson() {
    const sessionStr = localStorage.getItem('inst_session');
    if (!sessionStr) return;
    const session = JSON.parse(sessionStr);

    const { data: inst } = await _supabase.from('instructors').select('status, last_finish_time, current_lesson_start').eq('id', session.id).single();

    if (inst && inst.status === 'busy' && inst.last_finish_time) {
        const finishTime = new Date(inst.last_finish_time).getTime();
        const now = new Date().getTime();
        const diff = finishTime - now;

        if (diff > 0) {
            startTimerDisplay(diff);
        } else {
            await finalizeWorkTime(session.id);
            await stopProcessLocally();
        }
    }
}

async function stopProcessLocally() {
    console.log("Jarayon to'xtatildi. Skaner qayta yuklanmoqda...");

    if (activeTimer) {
        clearInterval(activeTimer);
        activeTimer = null;
    }

    isScanning = true;
    const readerDiv = document.getElementById('reader');

    if (readerDiv) {
        try {
            // Skanerni xavfsiz to'xtatish
            if (html5QrCode && html5QrCode.getState() > 1) {
                await html5QrCode.stop();
            }
        } catch (err) {
            console.warn("Skanerni to'xtatishda xatolik:", err);
        }

        readerDiv.innerHTML = "";

        // DOM yangilanishi uchun 300ms kutib skanerni yoqamiz
        setTimeout(() => {
            initScanner();
        }, 300);
    }

    updateInstStats();
    if (typeof loadClientList === 'function') loadClientList();
}

function initScanner() {
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onScanSuccess)
        .catch(err => console.error("Skaner xatosi:", err));
}

async function onScanSuccess(decodedText) {
    if (!isScanning) return;
    const session = JSON.parse(localStorage.getItem('inst_session'));
    const { data: inst } = await _supabase.from('instructors').select('status, last_finish_time').eq('id', session.id).single();

    if (inst && inst.status === 'busy') {
        const remainingMs = new Date(inst.last_finish_time) - new Date();
        const remainingMin = Math.ceil(remainingMs / 60000);
        if (remainingMin > 0) {
            alert(`Siz hozir bandsiz! Dars tugashiga ${remainingMin} daqiqa bor.`);
            return;
        }
    }

    isScanning = false;
    const { data: service } = await _supabase.from('school_services').select('*').eq('unique_id', decodedText).maybeSingle();

    if (service) {
        currentStudent = service;
        showStudentModal(service);
    } else {
        alert("Chek topilmadi yoki xato QR kod.");
        isScanning = true;
    }
}

function showStudentModal(service) {
    const modal = document.getElementById('studentModal');
    const dataArea = document.getElementById('modal-data');
    const footerArea = document.getElementById('modal-footer-btns');

    if (service.is_active === false) {
        dataArea.innerHTML = `<div style="text-align:center; padding: 20px;"><h2 style="color:#ef4444;">⚠️ YAROQSIZ CHEK</h2><p style="color:#94a3b8;">Bu chek ishlatilgan!</p></div>`;
        footerArea.innerHTML = `<button onclick="closeModal()" class="btn-cancel" style="width:100%">YOPISH</button>`;
    } else {
        dataArea.innerHTML = `
            <div class="mashgulot-info" style="text-align:left; line-height:1.8;">
                <h3 style="color:var(--accent); text-align:center;">Dars ma'lumotlari:</h3>
                <p>👤 <b>Ism:</b> ${service.full_name}</p>
                <p>🏢 <b>Markaz:</b> ${service.center_name}</p>
                <p>⌛ <b>Vaqt:</b> ${service.hours} soat</p>
                <p>💰 <b>Summa:</b> ${Number(service.payment_amount).toLocaleString()} UZS</p>
            </div>`;
        footerArea.innerHTML = `<button id="start-btn" onclick="confirmService()" class="btn-confirm" style="background:#10b981; color:white; width:100%; padding:14px; border-radius:10px; border:none; font-weight:bold; cursor:pointer;">BOSHLASH</button>`;
    }
    modal.style.display = 'flex';
}

async function confirmService() {
    if (!currentStudent) return;
    const startBtn = document.getElementById('start-btn');
    startBtn.disabled = true;
    startBtn.innerText = "YUKLANMOQDA...";

    try {
        const session = JSON.parse(localStorage.getItem('inst_session'));
        const hoursFromTicket = Number(currentStudent.hours);
        const now = new Date();
        const finishDate = new Date(now.getTime() + (hoursFromTicket * 3600000));

        await _supabase.from('instructors').update({
            status: 'busy',
            last_finish_time: finishDate.toISOString(),
            current_lesson_start: now.toISOString(),
            updated_at: now.toISOString()
        }).eq('id', session.id);

        await _supabase.from('school_services').update({
            is_active: false,
            instructor_id: session.id,
            service_start_time: now.toISOString(),
            last_finish_time: finishDate.toISOString()
        }).eq('unique_id', currentStudent.unique_id);

        await _supabase.from('services_history').insert([{
            instructor_id: session.id,
            student_name: currentStudent.full_name,
            hours: hoursFromTicket,
            service_id: currentStudent.unique_id,
            actual_hours: 0
        }]);

        startTimerDisplay(hoursFromTicket * 3600000);
        closeModal();
    } catch (err) {
        alert("Xatolik: " + err.message);
    } finally {
        if(startBtn) {
            startBtn.disabled = false;
            startBtn.innerText = "BOSHLASH";
        }
    }
}

async function finalizeWorkTime(instructorId) {
    try {
        const { data: inst } = await _supabase.from('instructors').select('*').eq('id', instructorId).single();
        if (!inst || !inst.current_lesson_start) {
            await _supabase.from('instructors').update({ status: 'active', current_lesson_start: null }).eq('id', instructorId);
            return;
        }

        const startTime = new Date(inst.current_lesson_start).getTime();
        const now = new Date().getTime();
        let diffMs = now - startTime;

        const plannedMs = new Date(inst.last_finish_time).getTime() - startTime;
        if (diffMs > plannedMs) diffMs = plannedMs;
        if (diffMs < 0) diffMs = 0;

        const workedMinutes = Math.floor(diffMs / 60000);
        const workedHours = workedMinutes / 60;
        const earnedMoney = Math.floor(workedHours * 40000);

        const lastUpdate = inst.updated_at ? new Date(inst.updated_at) : new Date();
        const isNewDay = lastUpdate.toDateString() !== new Date().toDateString();

        const newDaily = isNewDay ? workedMinutes : (inst.daily_hours || 0) + workedMinutes;
        const newMonthly = (inst.monthly_hours || 0) + workedMinutes;

        await _supabase.from('instructors').update({
            status: 'active',
            current_lesson_start: null,
            last_finish_time: null,
            daily_hours: newDaily,
            monthly_hours: newMonthly,
            earned_money: (inst.earned_money || 0) + earnedMoney,
            updated_at: new Date().toISOString()
        }).eq('id', instructorId);

        await _supabase.from('services_history')
            .update({ actual_hours: workedHours.toFixed(2) })
            .eq('instructor_id', instructorId)
            .order('created_at', { ascending: false })
            .limit(1);

    } catch (e) {
        console.error("Vaqtni hisoblashda xato:", e);
    }
}

function startTimerDisplay(durationMs) {
    const readerDiv = document.getElementById('reader');
    if (!readerDiv) return;

    isScanning = false;
    if (activeTimer) clearInterval(activeTimer);

    const endTime = Date.now() + durationMs;

    activeTimer = setInterval(async () => {
        const now = Date.now();
        const remaining = endTime - now;

        if (remaining <= 0) {
            clearInterval(activeTimer);
            activeTimer = null;
            playSound('finish');
            const session = JSON.parse(localStorage.getItem('inst_session'));
            await finalizeWorkTime(session.id);
            await stopProcessLocally();
            return;
        }

        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        const s = Math.floor((remaining % 60000) / 1000);

        readerDiv.innerHTML = `
            <div style="text-align:center; padding:40px; background:#1e293b; color:white; border-radius:15px; border:2px solid #f59e0b;">
                <h3 style="color:#f59e0b; margin-bottom:15px;">MASHG'ULOT KETMOQDA</h3>
                <div style="font-size:42px; font-weight:bold; font-family:monospace;">
                    ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}
                </div>
            </div>`;

        if (h === 0 && s === 0 && (m === 10 || m === 5)) playSound('warning');

    }, 1000);
}

async function updateInstStats() {
    const sessionStr = localStorage.getItem('inst_session');
    if(!sessionStr) return;
    const session = JSON.parse(sessionStr);
    const { data: inst } = await _supabase.from('instructors').select('*').eq('id', session.id).single();
    if (inst) {
        if(document.getElementById('total-hours')) document.getElementById('total-hours').innerText = (inst.daily_hours / 60).toFixed(1);
        if(document.getElementById('total-clients')) document.getElementById('total-clients').innerText = inst.total_clients || 0;
        if(document.getElementById('estimated-salary')) document.getElementById('estimated-salary').innerText = (inst.earned_money || 0).toLocaleString() + " UZS";
    }
}

async function loadClientList() {
    const sessionStr = localStorage.getItem('inst_session');
    if(!sessionStr) return;
    const session = JSON.parse(sessionStr);
    const { data } = await _supabase.from('services_history').select('*').eq('instructor_id', session.id).order('created_at', {ascending: false}).limit(10);
    const listDiv = document.getElementById('client-list');

    if (listDiv && data) {
        listDiv.innerHTML = data.length > 0 ? data.map(s => `
            <div class="stat-card" style="text-align:left; margin-bottom:10px; border-left:4px solid var(--accent)">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div><b>${s.student_name}</b><br><small>${new Date(s.created_at).toLocaleString()}</small></div>
                    <span style="color:var(--accent); font-weight:bold;">${Number(s.actual_hours) > 0 ? '+' + s.actual_hours + ' s' : 'Jarayonda'}</span>
                </div>
            </div>`).join('') : `<p style="color:#94a3b8; text-align:center;">Hozircha mijozlar yo'q</p>`;
    }
}

function closeModal() {
    const modal = document.getElementById('studentModal');
    if (modal) modal.style.display = 'none';
    if (!activeTimer) isScanning = true;
    currentStudent = null;
}

function logout() { confirmLogout(); }

function confirmLogout() {
    isScanning = false;
    const modal = document.getElementById('studentModal');
    document.getElementById('modal-data').innerHTML = `<h2 style="color:white; text-align:center;">Chiqish</h2><p style="text-align:center; color:#94a3b8;">Rostdan ham chiqmoqchimisiz?</p>`;
    document.getElementById('modal-footer-btns').innerHTML = `
        <div style="display:flex; gap:10px; width:100%;">
            <button onclick="executeLogout()" style="flex:1; background:#ef4444; color:white; border:none; padding:10px; border-radius:8px;">HA</button>
            <button onclick="closeModal()" style="flex:1; background:#64748b; color:white; border:none; padding:10px; border-radius:8px;">YO'Q</button>
        </div>`;
    modal.style.display = 'flex';
}

function executeLogout() {
    localStorage.clear();
    window.location.replace('index.html');
}

function watchStatusChanges() {
    const sessionStr = localStorage.getItem('inst_session');
    if (!sessionStr) return;
    const session = JSON.parse(sessionStr);

    _supabase.removeAllChannels();

    _supabase.channel('db-changes')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'instructors',
            filter: `id=eq.${session.id}`
        }, async (payload) => {
            console.log("Status o'zgardi:", payload.new.status);

            if (payload.new.status === 'active') {
                if (activeTimer) {
                    clearInterval(activeTimer);
                    activeTimer = null;
                }
                console.log("Dars yakunlandi.");
                await stopProcessLocally();
            }
        })
        .subscribe();
}