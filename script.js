console.log("WebSim VM Initializing...");

const V86_URLS = {
    bios: "https://cdn.jsdelivr.net/gh/copy/v86/bios/seabios.bin",
    vga_bios: "https://cdn.jsdelivr.net/gh/copy/v86/bios/vgabios.bin",
};

const room = new WebsimSocket();

let v86 = null;
let screenCaptureInterval = null;
let viewingClientId = null;

const goLiveButton = document.getElementById("go-live-button");
const remoteInputToggle = document.getElementById("remote-input-toggle");
const remoteInputLabel = document.getElementById("remote-input-label");
const startVmButton = document.getElementById("start-vm-button");
const stopVmButton = document.getElementById("stop-vm-button");
const isoInput = document.getElementById("iso-input");

async function main() {
    await room.initialize();
    console.log("WebSim Room Initialized.", room);

    setupMyInfo();
    updateMyStatus("Offline");
    
    room.subscribePresence(handlePresenceUpdate);
    room.subscribePresenceUpdateRequests(handlePresenceUpdateRequest);

    startVmButton.addEventListener("click", startVM);
    stopVmButton.addEventListener("click", stopVM);
    goLiveButton.addEventListener("click", toggleLive);
    remoteInputToggle.addEventListener("change", toggleRemoteInput);

    room.updatePresence({
        vmState: "off",
        isLive: false,
        allowRemoteInput: false,
        screenData: null,
    });
}

function setupMyInfo() {
    const me = room.peers[room.clientId];
    if (me) {
        document.getElementById("my-username").textContent = me.username;
        document.getElementById("my-avatar").src = me.avatarUrl;
    }
}

function updateMyStatus(status) {
    document.getElementById("my-status").textContent = status;
}

function handlePresenceUpdate(presence) {
    updateLiveUserList(presence);
    updateRemoteView(presence);
}

function updateLiveUserList(presence) {
    const list = document.getElementById("live-user-list");
    list.innerHTML = "";
    
    const liveUsers = Object.entries(presence).filter(([id, state]) => state.isLive && id !== room.clientId);

    if (liveUsers.length === 0) {
        list.innerHTML = "<li>No one is live.</li>";
        return;
    }

    liveUsers.forEach(([clientId, state]) => {
        const peer = room.peers[clientId];
        if (!peer) return;

        const li = document.createElement("li");
        li.dataset.clientId = clientId;
        li.innerHTML = `<img src="${peer.avatarUrl}" class="avatar"> ${peer.username}`;
        li.onclick = () => {
            viewingClientId = clientId;
            document.querySelectorAll("#live-user-list li").forEach(el => el.classList.remove("active"));
            li.classList.add("active");
            updateRemoteView(presence);
        };
        if (clientId === viewingClientId) {
            li.classList.add("active");
        }
        list.appendChild(li);
    });
}

function updateRemoteView(presence) {
    if (!viewingClientId) {
        document.getElementById("viewing-username").textContent = "Nobody";
        document.getElementById("stream-view").src = "placeholder.png";
        document.getElementById("remote-input-status").style.display = 'none';
        return;
    }
    
    const targetPresence = presence[viewingClientId];
    const targetPeer = room.peers[viewingClientId];

    if (!targetPresence || !targetPeer || !targetPresence.isLive) {
        viewingClientId = null;
        updateRemoteView(presence); // Recurse to reset view
        return;
    }

    document.getElementById("viewing-username").textContent = targetPeer.username;
    
    if (targetPresence.screenData) {
        document.getElementById("stream-view").src = targetPresence.screenData;
    }

    const remoteInputStatus = document.getElementById("remote-input-status");
    if (targetPresence.allowRemoteInput) {
        remoteInputStatus.style.display = 'block';
    } else {
        remoteInputStatus.style.display = 'none';
    }
}

function startVM() {
    const file = isoInput.files[0];
    if (!file) {
        alert("Please select an ISO or disk image file first.");
        return;
    }

    startVmButton.disabled = true;
    startVmButton.textContent = "Booting...";
    updateMyStatus("Booting...");
    
    const isoURL = URL.createObjectURL(file);
    
    const config = {
        screen_container: document.getElementById("screen-container"),
        bios: { url: V86_URLS.bios },
        vga_bios: { url: V86_URLS.vga_bios },
        autostart: true,
        memory_size: 512 * 1024 * 1024,
        vga_memory_size: 8 * 1024 * 1024,
        cdrom: { url: isoURL },
        network_relay_url: "wss://relay.widgetbot.io/", // Public relay
    };

    v86 = new V86Starter(config);

    v86.add_listener("emulator-ready", () => {
        console.log("VM Ready");
        goLiveButton.disabled = false;
        startVmButton.style.display = 'none';
        stopVmButton.style.display = 'inline-block';
        startVmButton.textContent = "Start VM";
        updateMyStatus("Running");
        room.updatePresence({ vmState: "running" });
    });
}

function stopVM() {
    if (v86) {
        v86.destroy();
        v86 = null;
    }
    if (screenCaptureInterval) {
        clearInterval(screenCaptureInterval);
        screenCaptureInterval = null;
    }
    goLiveButton.disabled = true;
    goLiveButton.classList.remove('live');
    goLiveButton.textContent = "Go Live";
    remoteInputLabel.style.display = 'none';
    
    stopVmButton.style.display = 'none';
    startVmButton.style.display = 'inline-block';
    startVmButton.disabled = false;

    updateMyStatus("Offline");

    room.updatePresence({
        vmState: "off",
        isLive: false,
        allowRemoteInput: false,
        screenData: null,
    });
}


function toggleLive() {
    const isCurrentlyLive = goLiveButton.classList.contains('live');
    if (isCurrentlyLive) {
        // Stop going live
        clearInterval(screenCaptureInterval);
        screenCaptureInterval = null;
        goLiveButton.classList.remove('live');
        goLiveButton.textContent = "Go Live";
        remoteInputLabel.style.display = 'none';
        remoteInputToggle.checked = false;
        room.updatePresence({ isLive: false, allowRemoteInput: false, screenData: null });
        updateMyStatus("Running");
    } else {
        // Start going live
        goLiveButton.classList.add('live');
        goLiveButton.textContent = "You are Live";
        remoteInputLabel.style.display = 'inline-flex';
        room.updatePresence({ isLive: true });
        updateMyStatus("Live");
        
        screenCaptureInterval = setInterval(() => {
            if (v86 && room.presence[room.clientId].isLive) {
                v86.take_screenshot((blob) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        room.updatePresence({ screenData: reader.result });
                    };
                    reader.readAsDataURL(blob);
                }, "image/jpeg");
            }
        }, 500); // 2 FPS
    }
}

function toggleRemoteInput() {
    const allow = remoteInputToggle.checked;
    room.updatePresence({ allowRemoteInput: allow });
}

// Viewer sends input
document.getElementById('stream-view').addEventListener('click', (e) => {
    if (!viewingClientId) return;

    const targetPresence = room.presence[viewingClientId];
    if (!targetPresence || !targetPresence.allowRemoteInput) return;
    
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Normalize coordinates based on the image's displayed size vs natural size
    const img = e.target;
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    const displayWidth = img.width;
    const displayHeight = img.height;
    
    const normX = Math.round((x / displayWidth) * naturalWidth);
    const normY = Math.round((y / displayHeight) * naturalHeight);

    console.log(`Sending mouse click to ${viewingClientId} at ${normX}, ${normY}`);
    room.requestPresenceUpdate(viewingClientId, {
        type: 'mouseClick',
        x: normX,
        y: normY,
    });
});

document.addEventListener('keydown', (e) => {
    if (!viewingClientId || !document.activeElement.closest('#remote-view-container')) return;
    
    const targetPresence = room.presence[viewingClientId];
    if (!targetPresence || !targetPresence.allowRemoteInput) return;

    e.preventDefault();
    console.log(`Sending key press to ${viewingClientId}: ${e.key}`);
    room.requestPresenceUpdate(viewingClientId, {
        type: 'keyEvent',
        key: e.key,
        keyCode: e.keyCode,
        which: e.which,
    });
});


// Host receives input
function handlePresenceUpdateRequest(updateRequest, fromClientId) {
    if (!v86 || !room.presence[room.clientId].allowRemoteInput) return;

    console.log(`Received request from ${fromClientId}:`, updateRequest);

    switch(updateRequest.type) {
        case 'mouseClick':
            v86.bus.send("mouse-click", {
                x: updateRequest.x,
                y: updateRequest.y,
            });
            break;
        case 'keyEvent':
             // v86 expects scan codes, but for simplicity we'll just send key presses for printable characters
            if (updateRequest.key && updateRequest.key.length === 1) {
                v86.bus.send("keyboard-input-char", updateRequest.key);
            }
            // A more complete implementation would map key codes to scan codes.
            break;
    }
}


main().catch(console.error);

