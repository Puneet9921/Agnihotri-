/**
 * AGNIHOTRI AEROSPACE - HUD V22.0
 * MISSION: Center Drone/Rocket & Fix Roll (Z)
 */

let port, reader, startTime, modelObject, scene, camera, renderer;
let gpsPacketCount = 0, txPacketCount = 0, flightData = [];
let gpsChart, txChart, map, marker;
let selectedMode = 'rocket';

// Smoothing & Telemetry
let uiXP=0, uiXN=0, uiYP=0, uiYN=0, uiZ=0;
let targetRotX=0, targetRotY=0, targetRotZ=0;
let currentRotX=0, currentRotY=0, currentRotZ=0;
const LERP_SPEED = 0.08;
let selectionScene, selectionCamera, selectionRenderer, selectionRocket;

// Initialize the background immediately
initSelectionEnvironment();

function initSelectionEnvironment() {
    const container = document.getElementById('selection-bg-canvas');
    selectionScene = new THREE.Scene();
    selectionCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    selectionRenderer = new THREE.WebGLRenderer({ antialias: true });
    selectionRenderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(selectionRenderer.domElement);

    // Add cinematic lighting
    selectionScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
    const spot = new THREE.SpotLight(0x00f3ff, 2);
    spot.position.set(10, 20, 10);
    selectionScene.add(spot);

    // Add a Grid Floor for a "hangar" look
    const grid = new THREE.GridHelper(200, 40, 0x00f3ff, 0x111111);
    grid.position.y = -5;
    selectionScene.add(grid);

    // Move camera for a cinematic angle
    selectionCamera.position.set(15, 10, 30);
    selectionCamera.lookAt(0, 5, 0);

    function animateSelection() {
        if (!selectionRenderer) return; 
        requestAnimationFrame(animateSelection);
        selectionScene.rotation.y += 0.002; // Slow cinematic rotation
        selectionRenderer.render(selectionScene, selectionCamera);
    }
    animateSelection();
}

// Function to handle the transition from Menu to HUD
function startMission(mode) {
    selectedMode = mode;
    
    // 1. Dispose of selection background to free up GPU memory
    if (selectionRenderer) {
        selectionRenderer.dispose();
        selectionRenderer = null;
        document.getElementById('selection-bg-canvas').remove();
    }

    // 2. Hide the selection menu
    document.getElementById('mode-selector-overlay').style.display = 'none';
    
    // 3. Initialize your main Tactical HUD and 3D Model
    initApp(); 
}

function launchApp(mode) {
    selectedMode = mode;
    document.getElementById('mode-selector-overlay').style.display = 'none';
    initApp();
}

function initApp() {
    init3D();
    initMap();
    initCharts();
    startClocks();
}

// --- 3D ENGINE: Centering & Loading ---
// --- 3D ENGINE: Centering & Loading ---
function init3D() {
    const container = document.getElementById('three-canvas');
    scene = new THREE.Scene();
    
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 5, 25); 
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(5, 10, 7);
    scene.add(sun);

    const loader = new THREE.GLTFLoader();
    const modelPath = selectedMode === 'rocket' ? 'rocket.glb' : 'drone.glb';

    loader.load(modelPath, (gltf) => {
        modelObject = gltf.scene;

        const box = new THREE.Box3().setFromObject(modelObject);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        let targetSize = (selectedMode === 'rocket') ? 18 : 10; 
        const scaleFactor = targetSize / Math.max(size.x, size.y, size.z);
        modelObject.scale.set(scaleFactor, scaleFactor, scaleFactor);
        
        // Center the geometry
        modelObject.position.x = -center.x * scaleFactor;
        modelObject.position.y = -center.y * scaleFactor;
        modelObject.position.z = -center.z * scaleFactor;

        // --- ROCKET VERTICAL ORIENTATION FIX ---
        if (selectedMode === 'rocket') {
            // Forces the rocket head to point UP (+Y)
            modelObject.rotation.x = -Math.PI / 2; 
        }

        const wrapper = new THREE.Group();
        wrapper.add(modelObject);
        scene.add(wrapper);
        modelObject = wrapper; 
    });

    function animate() {
        requestAnimationFrame(animate);
        if (modelObject) {
            currentRotX += (targetRotX - currentRotX) * LERP_SPEED;
            currentRotY += (targetRotY - currentRotY) * LERP_SPEED;
            currentRotZ += (targetRotZ - currentRotZ) * LERP_SPEED;
            
            modelObject.rotation.set(currentRotX, currentRotY, currentRotZ);

            const icon = document.getElementById('rocket-icon');
            if (icon) {
                let pS = (uiXP - uiXN) * 1.8; 
                let rS = (uiYP - uiYN) * 1.8; 
                const dist = Math.sqrt(pS*pS + rS*rS);
                const LIMIT = 40; 
                if (dist > LIMIT) {
                    pS *= (LIMIT / dist); rS *= (LIMIT / dist);
                }
                icon.style.transform = `translate(calc(-50% + ${rS}px), calc(-50% + ${-pS}px)) rotate(${uiZ}deg)`;
            }
        }
        renderer.render(scene, camera);
    }
    animate();
}

// --- DATA PROCESSING: Roll (Z) Fix ---
function processData(line) {
    flightData.push(line);
    const mTime = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "0";
    const txMatch = line.match(/<TX:([^>]+)>/);

    if (txMatch) {
        txPacketCount++;
        document.getElementById('val-tx-count').innerText = txPacketCount;
        const d = txMatch[1];

        uiZ  = parseFloat(findVal(d, 'Z')) || parseFloat(findVal(d, 'Yaw')) || 0;
        uiXP = parseFloat(findVal(d, 'X\\+')) || 0;
        uiXN = parseFloat(findVal(d, 'X\\-')) || 0;
        uiYP = parseFloat(findVal(d, 'Y\\+')) || 0;
        uiYN = parseFloat(findVal(d, 'Y\\-')) || 0;

        // --- UPDATED MAPPING FOR VERTICAL ROCKET ---
        if (selectedMode === 'rocket') {
            targetRotX = (uiYP - uiYN) * (Math.PI / 180);  // Tilts forward/back
            targetRotY = uiZ * (Math.PI / 180);            // Spins around vertical spine
            targetRotZ = -(uiXP - uiXN) * (Math.PI / 180); // Tilts side-to-side
        } else {
            // Standard Drone Mapping
            targetRotX = (uiXP - uiXN) * (Math.PI / 180);
            targetRotY = uiZ * (Math.PI / 180);
            targetRotZ = -(uiYP - uiYN) * (Math.PI / 180);
        }

        updateHUD('gyro-z', uiZ, "°", 0);
        updateHUD('gyro-x', uiXP, "", 0);
        updateHUD('gyro-x-neg', uiXN, "", 0);
        updateHUD('gyro-y', uiYP, "", 0);
        updateHUD('gyro-y-neg', uiYN, "", 0);
        
        updateHUD('sens-temp', findVal(d, 'Temp') || findVal(d, 'T'), " °C", 1);
        updateHUD('val-pres-gauge', findVal(d, 'Press') || findVal(d, 'P'), "", 1);
        
        const altKF = parseFloat(findVal(d, 'AltKF'));
        updateHUD('sens-alt', altKF, " m", 1);
        if (!isNaN(altKF)) updateChart(txChart, mTime, altKF);
    }
}
// ... helper functions (findVal, updateHUD, initCharts, etc.) remain the same ...

function findVal(str, key) {
    const regex = new RegExp(`${key}[+=-]*([-?0-9.]+)`, 'i');
    const m = str.match(regex);
    return m ? m[1] : null;
}

function updateHUD(id, val, suffix="", dec=null) {
    const el = document.getElementById(id);
    if (!el || val === null) return;
    let n = parseFloat(val);
    el.innerText = (!isNaN(n) ? (dec !== null ? n.toFixed(dec) : n) : val) + suffix;
}

// ... rest of your chart, map, and serial functions ...

function updateHUD(id, val, suffix="", dec=null) {
    const el = document.getElementById(id);
    if (!el || val === null) return;
    let n = parseFloat(val);
    el.innerText = (!isNaN(n) ? (dec !== null ? n.toFixed(dec) : n) : val) + suffix;
}

function initCharts() {
    const cfg = (col) => ({
        type: 'line',
        data: { labels: [], datasets: [{ data: [], borderColor: col, fill: true, backgroundColor: col+'11', pointRadius: 0, tension: 0.1 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: false }, 
        scales: { x: { display: false }, y: { position: 'right', grid: { color: '#111' }, ticks: { color: col, font: { size: 9 } } } } }
    });
    gpsChart = new Chart(document.getElementById('gpsAltChart'), cfg('#00d2ff'));
    txChart = new Chart(document.getElementById('txAltChart'), cfg('#00ff00'));
}

function updateChart(chart, label, val) {
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(val);
    if (chart.data.labels.length > 30) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); }
    chart.update('none');
}

function initMap() {
    map = L.map('mini-map', { zoomControl: false }).setView([12.935, 77.534], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    marker = L.marker([12.935, 77.534]).addTo(map);
}

async function refreshPorts() {
    port = await navigator.serial.requestPort();
    document.getElementById('com-ports').innerHTML = `<option>DEVICE READY</option>`;
}

async function connectSerial() {
    if (!port) return;
    await port.open({ baudRate: 115200 });
    startTime = Date.now();
    const td = new TextDecoderStream();
    port.readable.pipeTo(td.writable);
    reader = td.readable.getReader();
    readLoop();
}

async function readLoop() {
    let part = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        part += value;
        let lines = part.split('\n');
        part = lines.pop();
        for (let l of lines) if (l.trim().length > 5) processData(l.trim());
    }
}

function startClocks() {
    setInterval(() => {
        document.getElementById('timer-realtime').innerText = new Date().toLocaleTimeString('en-GB', {hour12:false});
        if (startTime) document.getElementById('timer-countdown').innerText = ((Date.now() - startTime) / 1000).toFixed(1);
    }, 100);
}

function downloadData() {
    const blob = new Blob([flightData.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `FlightLog.csv`;
    a.click();
}
/**
 * MISSION RESET LOGIC
 * Returns the user to the initial selection screen
 */
function resetMission() {
    if (confirm("Are you sure you want to end the current mission? Any unsaved telemetry data will be lost.")) {
        // Option A: The most stable way (Reloads the page to clear memory/serial ports)
        window.location.reload();

        /* // Option B: If you prefer not to reload, use this:
        document.getElementById('mode-selector-overlay').style.display = 'flex';
        if (port && port.opened) {
            reader.cancel();
            port.close();
        }
        // Reset counters
        gpsPacketCount = 0;
        txPacketCount = 0;
        startTime = null;
        flightData = [];
        */
    }
}
/**
 * Updates the visual status of a mission checklist box
 */
function updateStatusBox(id, isComplete) {
    const el = document.getElementById(id);
    if (!el) return;
    
    if (isComplete) {
        el.classList.remove('status-red');
        el.classList.add('status-green');
    } else {
        el.classList.add('status-red');
        el.classList.remove('status-green');
    }
}

/**
 * Sends command and updates local UI
 */
async function sendCommand(cmd) {
    if (!port || !port.writable) {
        alert("COMM LINK ERROR: Port not connected");
        return;
    }

    const encoder = new TextEncoder();
    const writer = port.writable.getWriter();
    await writer.write(encoder.encode(`<CMD:${cmd}>\n`));
    writer.releaseLock();

    // Update UI Feedback
    if (cmd === 'INIT') updateStatusBox('check-init', true);
    if (cmd === 'LAUNCH') updateStatusBox('check-launched', true);
    if (cmd === 'SEP') updateStatusBox('check-separate', true);
}