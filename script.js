import { clientId, redirectUri, scopes } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    const playPauseBtn = document.getElementById('play-pause-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const progressBar = document.getElementById('progress-bar');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const addToPlaylistBtn = document.getElementById('add-to-playlist-btn');
    const libraryBtn = document.getElementById('library-btn');
    const playlistModal = document.getElementById('playlist-modal');
    const closeModal = document.querySelector('.close-modal');
    const playlistList = document.getElementById('playlist-list');
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');

    let accessToken = localStorage.getItem('access_token');
    let isPlaying = false;
    let currentTrackUri = '';
    let isShuffle = false;

    // --- Event Listeners ---
    playPauseBtn.addEventListener('click', togglePlayback);
    prevBtn.addEventListener('click', () => sendCommand('previous'));
    nextBtn.addEventListener('click', () => sendCommand('next'));
    shuffleBtn.addEventListener('click', toggleShuffle);

    // --- PKCE Auth Flow ---

    function generateRandomString(length) {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    async function generateCodeChallenge(codeVerifier) {
        // Use js-sha256 library if available (for HTTP), otherwise fallback to crypto API (HTTPS/Localhost)
        if (window.sha256) {
            log('Using js-sha256 for PKCE');
            const hash = sha256.array(codeVerifier);
            return btoa(String.fromCharCode.apply(null, hash))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        } else {
            log('Using crypto.subtle for PKCE');
            const data = new TextEncoder().encode(codeVerifier);
            const digest = await window.crypto.subtle.digest('SHA-256', data);
            return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        }
    }

    async function redirectToAuth() {
        log('Starting Auth Redirect...');
        try {
            const verifier = generateRandomString(128);
            localStorage.setItem('verifier', verifier);

            const challenge = await generateCodeChallenge(verifier);
            const params = new URLSearchParams();
            params.append('client_id', clientId);
            params.append('response_type', 'code');
            params.append('redirect_uri', redirectUri);
            params.append('scope', scopes.join(' '));
            params.append('code_challenge_method', 'S256');
            params.append('code_challenge', challenge);

            log('Redirecting to Spotify...');
            document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
        } catch (e) {
            log(`Auth Error: ${e.message}`);
            console.error(e);
        }
    }

    async function handleRedirect() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (code) {
            const verifier = localStorage.getItem('verifier');
            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri,
                client_id: clientId,
                code_verifier: verifier
            });

            try {
                const response = await fetch('https://accounts.spotify.com/api/token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: body
                });

                if (!response.ok) {
                    throw new Error('Failed to exchange code for token');
                }

                const data = await response.json();
                accessToken = data.access_token;
                localStorage.setItem('access_token', accessToken);

                // Clean URL
                window.history.replaceState({}, document.title, '/index.html');

                fetchNowPlaying();
            } catch (error) {
                console.error('Error exchanging token:', error);
                showToast('Auth Error: ' + error.message);
            }
        } else if (params.get('error')) {
            showToast('Auth Error: ' + params.get('error'));
        } else if (!accessToken) {
            // If no code and no token, redirect to auth
            if (clientId !== 'YOUR_CLIENT_ID_HERE') {
                redirectToAuth();
            }
        } else {
            // We have a token, start fetching
            fetchNowPlaying();
        }
    }

    const debugInfo = document.getElementById('debug-info');

    function log(msg) {
        console.log(msg);
        if (debugInfo) debugInfo.textContent = msg;
    }

    // --- API Calls ---
    async function fetchNowPlaying() {
        if (!accessToken) {
            log('No Access Token. Redirecting...');
            redirectToAuth();
            return;
        }

        try {
            const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            log(`API Status: ${response.status}`);

            if (response.status === 204) {
                console.log('No content (Not playing)');
                showToast('No music playing on Spotify');
                songTitle.textContent = 'Not Playing';
                artistName.textContent = 'Open Spotify & Play Something';
                return;
            }

            if (response.status > 400) {
                if (response.status === 401) {
                    log('Token expired (401). Reloading...');
                    showToast('Session expired. Re-authenticating...');
                    localStorage.removeItem('access_token');
                    setTimeout(redirectToAuth, 2000);
                } else {
                    log(`Error: ${response.status} ${response.statusText}`);
                    showToast(`Spotify Error: ${response.status}`);
                }
                return;
            }

            const data = await response.json();
            updateUI(data);
            log(`Playing: ${data.item.name}`);
        } catch (error) {
            console.error('Error fetching now playing:', error);
            log(`Fetch Error: ${error.message}`);
            showToast('Error connecting to Spotify');
        }
    }

    async function sendCommand(command, method = 'POST') {
        if (!accessToken) return;
        try {
            await fetch(`https://api.spotify.com/v1/me/player/${command}`, {
                method: method,
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            setTimeout(fetchNowPlaying, 500); // Refresh after command
        } catch (error) {
            console.error(`Error sending command ${command}:`, error);
        }
    }

    // --- Playlist Functionality ---
    const addToPlaylistBtn = document.getElementById('add-to-playlist-btn');
    const myPlaylistsBtn = document.getElementById('my-playlists-btn');
    const playlistModal = document.getElementById('playlist-modal');
    const modalTitle = document.getElementById('modal-title');
    const playlistList = document.getElementById('playlist-list');
    const closeModal = document.querySelector('.close-modal');

    let currentTrackUri = null;
    let isAddingMode = false; // true = adding track, false = playing playlist

    addToPlaylistBtn.addEventListener('click', () => {
        if (!currentTrackUri) {
            showToast('No track playing');
            return;
        }
        isAddingMode = true;
        modalTitle.textContent = 'Add to Playlist';
        openPlaylistModal();
    });

    myPlaylistsBtn.addEventListener('click', () => {
        isAddingMode = false;
        modalTitle.textContent = 'My Playlists';
        openPlaylistModal();
    });

    closeModal.addEventListener('click', () => {
        playlistModal.classList.remove('show');
    });

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === playlistModal) {
            playlistModal.classList.remove('show');
        }
    });

    async function openPlaylistModal() {
        playlistModal.classList.add('show');
        playlistList.innerHTML = '<div style="text-align:center; padding: 20px;">Loading...</div>';

        const playlists = await fetchUserPlaylists();
        renderPlaylists(playlists);
    }

    async function fetchUserPlaylists() {
        if (!accessToken) return [];
        try {
            const response = await fetch('https://api.spotify.com/v1/me/playlists?limit=50', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const data = await response.json();
            return data.items;
        } catch (error) {
            console.error('Error fetching playlists:', error);
            log(`Playlist Error: ${error.message}`);
            return [];
        }
    }

    function renderPlaylists(playlists) {
        playlistList.innerHTML = '';
        if (!playlists || playlists.length === 0) {
            playlistList.innerHTML = '<div style="text-align:center; padding: 20px;">No playlists found</div>';
            return;
        }

        playlists.forEach(playlist => {
            const div = document.createElement('div');
            div.className = 'playlist-item';
            div.innerHTML = `
                <img src="${playlist.images[0] ? playlist.images[0].url : ''}" class="playlist-img">
                <span class="playlist-name">${playlist.name}</span>
            `;
            div.addEventListener('click', () => {
                if (isAddingMode) {
                    addTrackToPlaylist(playlist.id);
                } else {
                    playPlaylist(playlist.uri);
                }
                playlistModal.classList.remove('show');
            });
            playlistList.appendChild(div);
        });
    }

    async function addTrackToPlaylist(playlistId) {
        if (!accessToken || !currentTrackUri) return;
        try {
            await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ uris: [currentTrackUri] })
            });
            showToast('Added to playlist!');
        } catch (error) {
            console.error('Add to playlist error:', error);
            log(`Add Error: ${error.message}`);
            showToast('Failed to add track');
        }
    }

    async function playPlaylist(uri) {
        if (!accessToken) return;
        try {
            await fetch(`https://api.spotify.com/v1/me/player/play`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ context_uri: uri })
            });
            showToast('Starting playlist...');
            setTimeout(fetchNowPlaying, 1000);
        } catch (error) {
            console.error('Play playlist error:', error);
            log(`Play Error: ${error.message}`);
            showToast('Failed to play playlist');
        }
    }

    // --- UI Updates ---
    function updateUI(data) {
        if (!data || !data.item) return;

        const track = data.item;
        currentTrackUri = track.uri; // Store for adding to playlist
        songTitle.textContent = track.name;
        artistName.textContent = track.artists.map(a => a.name).join(', ');
        albumArt.src = track.album.images[0].url;

        const isPlaying = data.is_playing;
        if (isPlaying) {
            btnText.textContent = 'PAUSE';
            btnIndicator.classList.remove('paused');
        } else {
            btnText.textContent = 'PLAY';
            btnIndicator.classList.add('paused');
        }
    }

    function showToast(message) {
        toastMessage.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 2000);
    }

    // --- Event Listeners ---
    playPauseBtn.addEventListener('click', () => {
        const isPaused = btnIndicator.classList.contains('paused');
        if (isPaused) {
            sendCommand('play', 'PUT');
            showToast('Resuming...');
        } else {
            sendCommand('pause', 'PUT');
            showToast('Pausing...');
        }
    });

    prevBtn.addEventListener('click', () => {
        sendCommand('previous', 'POST');
        showToast('Previous Track');
    });

    nextBtn.addEventListener('click', () => {
        sendCommand('next', 'POST');
        showToast('Next Track');
    });

    // --- Search Functionality ---
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    let searchTimeout = null;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;
        clearTimeout(searchTimeout);

        if (query.length > 0) {
            searchTimeout = setTimeout(() => {
                performSearch(query);
            }, 500); // Debounce 500ms
        } else {
            searchResults.classList.remove('show');
            searchResults.innerHTML = '';
        }
    });

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.remove('show');
        }
    });

    // --- PIN & Splash Screen Logic ---
    const splashScreen = document.getElementById('splash-screen');
    const pinScreen = document.getElementById('pin-screen');
    const pinTitle = document.getElementById('pin-title');
    const pinDots = document.querySelectorAll('.dot');
    const pinKeys = document.querySelectorAll('.pin-key');

    let currentPin = '';
    let savedPin = localStorage.getItem('app_pin');
    let isSettingPin = !savedPin;

    if (isSettingPin) {
        pinTitle.textContent = 'Set New PIN';
    } else {
        pinTitle.textContent = 'Enter PIN';
    }

    // Handle PIN Input
    pinKeys.forEach(key => {
        key.addEventListener('click', () => {
            const value = key.dataset.key;

            if (value === 'C') {
                currentPin = '';
                updatePinDots();
                return;
            }

            if (value === 'OK') {
                checkPin();
                return;
            }

            if (currentPin.length < 4) {
                currentPin += value;
                updatePinDots();

                // Auto-submit on 4th digit
                if (currentPin.length === 4) {
                    setTimeout(checkPin, 50); // Reduced delay for faster feel
                }
            }
        });
    });

    // Global Error Handler for Mobile Debugging
    window.onerror = function (msg, url, lineNo, columnNo, error) {
        const string = msg.toLowerCase();
        const substring = "script error";
        if (string.indexOf(substring) > -1) {
            log('Script Error: See Browser Console for Detail');
        } else {
            log(`Error: ${msg} at line ${lineNo}:${columnNo}`);
        }
        return false;
    };

    function updatePinDots() {
        pinDots.forEach((dot, index) => {
            if (index < currentPin.length) {
                dot.classList.add('filled');
            } else {
                dot.classList.remove('filled');
            }
        });
    }

    function checkPin() {
        if (currentPin.length !== 4) return;

        if (isSettingPin) {
            // Confirm PIN (Simplified: just set it)
            localStorage.setItem('app_pin', currentPin);
            savedPin = currentPin;
            isSettingPin = false;
            showToast('PIN Set Successfully!');
            unlockApp();
        } else {
            if (currentPin === savedPin) {
                unlockApp();
            } else {
                showToast('Incorrect PIN');
                currentPin = '';
                updatePinDots();
                pinContainerShake();
            }
        }
    }

    function pinContainerShake() {
        const container = document.querySelector('.pin-container');
        container.style.transform = 'translateX(10px)';
        setTimeout(() => {
            container.style.transform = 'translateX(-10px)';
            setTimeout(() => {
                container.style.transform = 'translateX(0)';
            }, 100);
        }, 100);
    }

    function unlockApp() {
        pinScreen.classList.add('hidden');
    }

    // --- Search Functionality (Updated for Playlists) ---
    async function performSearch(query) {
        if (!accessToken) return;

        try {
            // Search for tracks AND playlists
            const response = await fetch(`https://api.spotify.com/v1/search?type=track,playlist&limit=5&q=${encodeURIComponent(query)}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (!response.ok) throw new Error('Search failed');

            const data = await response.json();
            renderSearchResults(data);
        } catch (error) {
            console.error('Search error:', error);
            log(`Search Error: ${error.message}`);
        }
    }

    function renderSearchResults(data) {
        searchResults.innerHTML = '';
        const tracks = data.tracks ? data.tracks.items : [];
        const playlists = data.playlists ? data.playlists.items : [];

        if (tracks.length === 0 && playlists.length === 0) {
            searchResults.classList.remove('show');
            return;
        }

        // Render Playlists First
        if (playlists.length > 0) {
            const header = document.createElement('div');
            header.style.padding = '5px 10px';
            header.style.fontSize = '0.8rem';
            header.style.opacity = '0.7';
            header.textContent = 'PLAYLISTS';
            searchResults.appendChild(header);

            playlists.forEach(playlist => {
                if (!playlist) return;
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `
                    <img src="${playlist.images[0] ? playlist.images[0].url : ''}" class="result-img">
                    <div class="result-info">
                        <span class="result-title">${playlist.name}</span>
                        <span class="result-artist">Playlist</span>
                    </div>
                `;
                div.addEventListener('click', () => {
                    playPlaylist(playlist.uri);
                    searchResults.classList.remove('show');
                    searchInput.value = '';
                });
                searchResults.appendChild(div);
            });
        }

        // Render Tracks
        if (tracks.length > 0) {
            const header = document.createElement('div');
            header.style.padding = '5px 10px';
            header.style.fontSize = '0.8rem';
            header.style.opacity = '0.7';
            header.style.marginTop = '10px';
            header.textContent = 'SONGS';
            searchResults.appendChild(header);

            tracks.forEach(track => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.innerHTML = `
                    <img src="${track.album.images[2] ? track.album.images[2].url : ''}" class="result-img">
                    <div class="result-info">
                        <span class="result-title">${track.name}</span>
                        <span class="result-artist">${track.artists.map(a => a.name).join(', ')}</span>
                    </div>
                `;
                div.addEventListener('click', () => {
                    playTrack(track.uri);
                    searchResults.classList.remove('show');
                    searchInput.value = '';
                });
                searchResults.appendChild(div);
            });
        }

        searchResults.classList.add('show');
    }

    async function playTrack(uri) {
        if (!accessToken) return;
        try {
            await fetch(`https://api.spotify.com/v1/me/player/play`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ uris: [uri] })
            });
            showToast('Playing selected track...');
            setTimeout(fetchNowPlaying, 1000);
        } catch (error) {
            console.error('Play error:', error);
            log(`Play Error: ${error.message}`);
            showToast('Failed to play track');
        }
    }

    // --- Initialization ---
    handleRedirect();
    // Don't start polling immediately if blocked by PIN, but for now it's fine as it runs in background
    setInterval(fetchNowPlaying, 5000);

    // Hide Splash Screen after delay to show PIN or App
    setTimeout(() => {
        splashScreen.classList.add('hidden');
    }, 2000);

    // Dynamic Tilt Removed (Static Tilt applied in CSS)
});
