import { 
    saveRecord, 
    listenToLeaderboard, 
    listenToSettings, 
    updateResetPeriod, 
    triggerInstantReset,
    getFirebaseStatus,
    checkFirebaseConnectivity,
    triggerAutoReset,
    triggerLocalAutoReset
} from "./firebase-config.js";

// =================================================================
// 1. 게임 상태 정의 & 설정값
// =================================================================
const DIFFICULTY_CONFIG = {
    easy: { rows: 9, cols: 9, mines: 10 },
    medium: { rows: 16, cols: 16, mines: 40 },
    hard: { rows: 20, cols: 20, mines: 80 }
};

let currentGameDifficulty = "easy"; // 현재 게임 난이도
let currentViewDifficulty = "easy"; // 리더보드 조회 난이도

let rows = DIFFICULTY_CONFIG.easy.rows;
let cols = DIFFICULTY_CONFIG.easy.cols;
let minesCount = DIFFICULTY_CONFIG.easy.mines;

let board = [];
let gameState = "idle"; // idle (이름 입력 전) -> ready (입력 후 첫 클릭 대기) -> playing (플레이 중) -> ended (종료)
let playerName = "";
let timer = 0;
let timerInterval = null;
let flaggedCount = 0;
let correctFlagsCount = 0;
let firstClick = true;

// Firestore 실시간 리셋 설정을 동기화하여 담는 객체 (자동 주기 리셋 스키마 포함)
let leaderboardSettings = {
    resetPeriod: 60,
    lastManualReset: 0,
    lastSystemReset: 0,
    nextResetTimestamp: 0
};

// 현재 리더보드 화면에 노출 중인 문서 ID들 (개발자 모드 즉시 리셋 시 사용)
let activeLeaderboardDocIds = [];

// =================================================================
// 2. DOM 요소 참조
// =================================================================
const minefieldEl = document.getElementById("minefield");
const timerEl = document.getElementById("game-timer");
const minesLeftEl = document.getElementById("mines-left");
const restartBtn = document.getElementById("restart-btn");
const boardOverlayEl = document.getElementById("board-overlay");
const nicknameForm = document.getElementById("nickname-form");
const nicknameInput = document.getElementById("nickname-input");
const playerInfoBar = document.getElementById("player-info-bar");
const currentPlayerNameEl = document.getElementById("current-player-name");
const changeNameBtn = document.getElementById("change-name-btn");

// 모달 요소
const resultModalEl = document.getElementById("result-modal");
const modalBannerEl = document.getElementById("modal-banner");
const resultTimeEl = document.getElementById("result-time");
const resultFlagsEl = document.getElementById("result-flags");
const resultMessageEl = document.getElementById("result-message");
const modalRestartBtn = document.getElementById("modal-restart-btn");

// 리더보드 요소
const leaderboardListEl = document.getElementById("leaderboard-list");
const resetBadgeInfoEl = document.getElementById("reset-badge-info");
const resetTimerTextEl = document.getElementById("reset-timer-text");

// 개발자 패널 요소
const devPanelEl = document.getElementById("dev-panel");
const devPeriodInput = document.getElementById("dev-period-input");
const devPeriodApplyBtn = document.getElementById("dev-period-apply-btn");
const devInstantResetBtn = document.getElementById("dev-instant-reset-btn");
const devCloseBtn = document.getElementById("dev-close-btn");

// =================================================================
// 3. 지뢰찾기 게임 핵심 엔진
// =================================================================

/**
 * 게임 보드 논리 배열 초기화
 */
function initBoard() {
    board = [];
    firstClick = true;
    flaggedCount = 0;
    correctFlagsCount = 0;
    updateMinesLeftUI();

    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
            row.push({
                r: r,
                c: c,
                isMine: false,
                isOpened: false,
                isFlagged: false,
                neighborMines: 0
            });
        }
        board.push(row);
    }
}

/**
 * 첫 클릭 이후 지뢰를 무작위로 심고 인접 지뢰 카운팅
 * (첫 클릭한 좌표 r, c에는 지뢰가 들어가지 않도록 보호)
 */
function generateMines(firstR, firstC) {
    let minesPlanted = 0;
    while (minesPlanted < minesCount) {
        const r = Math.floor(Math.random() * rows);
        const c = Math.floor(Math.random() * cols);

        // 첫 클릭한 곳 및 이미 지뢰가 심어진 곳 제외
        if ((r === firstR && c === firstC) || board[r][c].isMine) {
            continue;
        }

        board[r][c].isMine = true;
        minesPlanted++;
    }

    // 인접 지뢰 개수 계산
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (!board[r][c].isMine) {
                board[r][c].neighborMines = countNeighborMines(r, c);
            }
        }
    }
}

/**
 * 인접한 8개 격자의 지뢰 개수를 카운팅하는 헬퍼
 */
function countNeighborMines(row, col) {
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const nr = row + dr;
            const nc = col + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                if (board[nr][nc].isMine) {
                    count++;
                }
            }
        }
    }
    return count;
}

/**
 * 화면 격자판(DOM) 렌더링
 */
function renderField() {
    minefieldEl.innerHTML = "";
    
    // 난이도 크기에 따른 격자 template columns/rows 동적 세팅
    minefieldEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    minefieldEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cellData = board[r][c];
            const cellEl = document.createElement("div");
            cellEl.classList.add("cell");
            cellEl.dataset.row = r;
            cellEl.dataset.col = c;
            cellEl.setAttribute("role", "gridcell");
            cellEl.setAttribute("id", `cell-${r}-${c}`);
            
            // 우클릭 방지 & 깃발 꽂기 바인딩
            cellEl.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                handleCellRightClick(r, c);
            });

            // 좌클릭 타일 열기 바인딩
            cellEl.addEventListener("click", () => {
                handleCellLeftClick(r, c);
            });

            minefieldEl.appendChild(cellEl);
        }
    }
}

/**
 * 좌클릭 처리: 타일 열기
 */
function handleCellLeftClick(r, c) {
    if (gameState !== "ready" && gameState !== "playing") return;

    const cell = board[r][c];
    if (cell.isOpened || cell.isFlagged) return;

    // 첫 클릭 시 지뢰 배치 및 타이머 작동 시작 (불합리한 폭사 방지)
    if (firstClick) {
        firstClick = false;
        generateMines(r, c);
        gameState = "playing";
        startTimer();
    }

    // 지뢰를 밟은 경우 -> 패배
    if (cell.isMine) {
        gameOver(false, r, c);
        return;
    }

    // 안전한 타일 오픈
    openCell(r, c);

    // 승리 조건 체크
    checkWinCondition();
}

/**
 * 재귀적 Flood Fill 타일 오픈 (주변 지뢰가 0일 경우 사방으로 자동 확장)
 */
function openCell(r, c) {
    const cell = board[r][c];
    if (cell.isOpened || cell.isFlagged) return;

    cell.isOpened = true;
    const cellEl = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
    if (cellEl) {
        cellEl.classList.add("opened");
        if (cell.neighborMines > 0) {
            cellEl.textContent = cell.neighborMines;
            cellEl.classList.add(`num-${cell.neighborMines}`);
        }
    }

    // 인접 지뢰가 0인 경우 연쇄 오픈
    if (cell.neighborMines === 0) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                    if (!board[nr][nc].isMine && !board[nr][nc].isOpened) {
                        openCell(nr, nc);
                    }
                }
            }
        }
    }
}

/**
 * 우클릭 처리: 깃발 꽂기/취소
 */
function handleCellRightClick(r, c) {
    if (gameState !== "ready" && gameState !== "playing") return;

    const cell = board[r][c];
    if (cell.isOpened) return;

    cell.isFlagged = !cell.isFlagged;
    
    // 깃발 개수 상태 업데이트
    if (cell.isFlagged) {
        flaggedCount++;
    } else {
        flaggedCount--;
    }

    const cellEl = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
    if (cellEl) {
        if (cell.isFlagged) {
            cellEl.classList.add("flagged");
            cellEl.innerHTML = `<i class="fa-solid fa-flag"></i>`;
        } else {
            cellEl.classList.remove("flagged");
            cellEl.innerHTML = "";
        }
    }

    updateMinesLeftUI();
}

/**
 * 남은 지뢰 개수 UI 업데이트 (지뢰 수 - 깃발 수)
 */
function updateMinesLeftUI() {
    const left = minesCount - flaggedCount;
    minesLeftEl.textContent = left;
}

/**
 * 승리 여부 판단 (지뢰를 제외한 모든 칸이 열렸는지)
 */
function checkWinCondition() {
    let openedCount = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (board[r][c].isOpened) {
                openedCount++;
            }
        }
    }

    const targetOpened = (rows * cols) - minesCount;
    if (openedCount === targetOpened) {
        gameOver(true);
    }
}

/**
 * 타이머 관리
 */
function startTimer() {
    clearInterval(timerInterval);
    timer = 0;
    updateTimerUI();
    timerInterval = setInterval(() => {
        timer++;
        if (timer > 999) timer = 999; // 3자리 숫자 최대치 제한
        updateTimerUI();
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

function updateTimerUI() {
    timerEl.textContent = String(timer).padStart(3, "0");
}

/**
 * 게임 종료 핸들러 (승리 / 패배)
 */
function gameOver(isWin, clickedMineR = null, clickedMineC = null) {
    gameState = "ended";
    stopTimer();

    // 1) 지뢰 정답 위치와 정확히 꽂은 깃발 개수 계산
    correctFlagsCount = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = board[r][c];
            const cellEl = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);

            if (cell.isMine) {
                if (cell.isFlagged) {
                    correctFlagsCount++;
                } else if (!isWin) {
                    // 패배 시 터지지 않은 지뢰 공개
                    if (r === clickedMineR && c === clickedMineC) {
                        cellEl.classList.add("mine");
                        cellEl.innerHTML = `<i class="fa-solid fa-burst"></i>`;
                    } else {
                        cellEl.classList.add("opened");
                        cellEl.innerHTML = `<i class="fa-solid fa-bomb text-cyan"></i>`;
                    }
                }
            } else {
                // 지뢰가 없는데 잘못 꽂힌 깃발 공개 (패배 시)
                if (cell.isFlagged && !isWin) {
                    cellEl.classList.add("mine-wrong");
                    cellEl.innerHTML = `<i class="fa-solid fa-ban"></i>`;
                }
            }
        }
    }

    // 2) Firestore DB에 기록 저장 (난이도 필드 및 커스텀 파라미터 전달)
    if (currentGameDifficulty === "custom") {
        saveRecord(playerName, isWin, timer, correctFlagsCount, currentGameDifficulty, rows, minesCount, cols);
    } else {
        saveRecord(playerName, isWin, timer, correctFlagsCount, currentGameDifficulty);
    }

    // 3) 결과 모달 출력
    showResultModal(isWin);
}

/**
 * 결과 모달 팝업 노출
 */
function showResultModal(isWin) {
    modalBannerEl.className = "modal-banner " + (isWin ? "win" : "lose");
    
    if (isWin) {
        modalBannerEl.innerHTML = `
            <i class="fa-solid fa-trophy text-yellow floating-icon"></i>
            <h2>VICTORY!</h2>
        `;
        resultMessageEl.textContent = `축하합니다, ${playerName}님! 모든 지뢰를 피해서 보드를 완벽하게 클리어하셨습니다. 기록이 실시간 리더보드에 등록되었습니다.`;
    } else {
        modalBannerEl.innerHTML = `
            <i class="fa-solid fa-skull-crossbones text-pink floating-icon"></i>
            <h2>GAME OVER</h2>
        `;
        resultMessageEl.textContent = `아쉽군요! 지뢰를 밟고 말았습니다. 그래도 지뢰에 꽂아둔 정확한 깃발 수로 기록은 저장되니 다음 기회에 더 신속하게 도전해 보세요.`;
    }

    resultTimeEl.textContent = `${timer}초`;
    resultFlagsEl.textContent = `${correctFlagsCount}개 / ${minesCount}개`;
    
    resultModalEl.classList.remove("hidden");
}

/**
 * 게임 시작 준비 상태로 복귀
 */
function resetGame() {
    resultModalEl.classList.add("hidden");
    stopTimer();
    timer = 0;
    updateTimerUI();
    
    // 설정된 게임 난이도로 격자 규격 재조정 (커스텀 제외)
    if (currentGameDifficulty !== "custom") {
        const config = DIFFICULTY_CONFIG[currentGameDifficulty];
        rows = config.rows;
        cols = config.cols;
        minesCount = config.mines;
    }

    initBoard();
    renderField();
    
    // 매 판마다 닉네임 입력 칸과 시작 버튼이 나오도록 설정
    gameState = "idle";
    boardOverlayEl.classList.add("active");

    // 라디오 선택 상태 및 커스텀 패널 노출 동기화
    const activeRadio = nicknameForm.querySelector(`input[name="difficulty"][value="${currentGameDifficulty}"]`);
    if (activeRadio) activeRadio.checked = true;
    
    const customSettingsEl = document.getElementById("custom-settings");
    if (currentGameDifficulty === "custom") {
        customSettingsEl.classList.remove("hidden");
    } else {
        customSettingsEl.classList.add("hidden");
    }
    
    // 기존에 플레이어가 입력한 닉네임이 있다면 인풋 창에 미리 채워줍니다.
    if (playerName) {
        nicknameInput.value = playerName;
    }
}

// =================================================================
// 4. 리더보드 데이터 정렬 및 렌더링 (onSnapshot 수신 데이터)
// =================================================================
let rawRecords = [];

/**
 * 랭킹 산정 기준에 따라 리더보드 화면 렌더링
 * 1순위: 클리어 유저 -> 클리어 시간 오름차순(짧은 순)
 * 2순위: 미클리어 유저 -> 올바르게 꽂은 깃발 수 내림차순(많은 순)
 */
function filterAndRenderLeaderboard() {
    const now = Date.now();
    const lastSystemReset = leaderboardSettings.lastSystemReset || 0;
    const lastManualReset = leaderboardSettings.lastManualReset || 0;

    // 1) 리셋 주기 및 수동 리셋 조건 및 난이도에 부합하는 데이터만 필터링
    const activeRecords = rawRecords.filter((record) => {
        const ts = record.timestamp || now;
        const isPending = record.isPending;
        
        // 규칙 1: 시스템 공통 자동 리셋 시간보다 이후 기록인지 확인 (모두에게 동시 리셋 보장)
        const isAfterSystemReset = isPending || (ts > lastSystemReset);
        
        // 규칙 2: 마지막 수동 즉시 리셋 시간보다 이후 기록인지 확인
        const isAfterManualReset = isPending || (ts > lastManualReset);

        // 규칙 3: 현재 조회 중인 난이도 탭과 일치하는지 확인 (이전 누락 데이터는 'easy'로 매핑)
        const isSameDifficulty = (record.difficulty || "easy") === currentViewDifficulty;

        return isAfterSystemReset && isAfterManualReset && isSameDifficulty;
    });

    // 2) 랭킹 정렬 로직 적용
    activeRecords.sort((a, b) => {
        // 1순위: 클리어 여부 (true인 항목이 최상단)
        if (a.cleared !== b.cleared) {
            return a.cleared ? -1 : 1;
        }

        // 2순위-A: 클리어한 유저들 간에는 클리어 시간(초) 오름차순 (짧은 순)
        if (a.cleared) {
            return a.clearTime - b.clearTime;
        }

        // 2순위-B: 클리어하지 못한 유저들 간에는 정확하게 꽂은 깃발 수 내림차순 (많은 순)
        return b.correctFlags - a.correctFlags;
    });

    // 수동 리셋 시 삭제할 문서 ID 목록 수집
    activeLeaderboardDocIds = activeRecords.map(r => r.id);

    // 3) HTML 렌더링
    leaderboardListEl.innerHTML = "";
    
    if (activeRecords.length === 0) {
        leaderboardListEl.innerHTML = `
            <div class="empty-state">
                <i class="fa-regular fa-folder-open"></i>
                <span>현재 랭킹 기록이 없습니다.</span>
                <small>첫 번째 기록의 주인공이 되어보세요!</small>
            </div>
        `;
        return;
    }

    activeRecords.forEach((record, index) => {
        const rank = index + 1;
        const rowEl = document.createElement("div");
        rowEl.classList.add("leaderboard-row");
        
        // 현재 플레이어와 닉네임이 같으면 강조 표시
        if (playerName && record.name === playerName) {
            rowEl.classList.add("highlight");
        }

        // 순위 열 포맷팅 (Top 3 트로피 아이콘 제공)
        let rankContent = `<span class="rank-badge">${rank}</span>`;
        if (rank === 1) rankContent = `<i class="fa-solid fa-trophy rank-1" title="1등"></i>`;
        else if (rank === 2) rankContent = `<i class="fa-solid fa-medal rank-2" title="2등"></i>`;
        else if (rank === 3) rankContent = `<i class="fa-solid fa-medal rank-3" title="3등"></i>`;

        // 결과 배지 생성
        const statusBadge = record.cleared 
            ? `<span class="badge-clear">Clear</span>` 
            : `<span class="badge-fail">Fail</span>`;

        // 점수 텍스트 포맷팅 (클리어 시간 또는 깃발 수)
        const scoreText = record.cleared 
            ? `${record.clearTime}초` 
            : `🚩 ${record.correctFlags}개`;

        let nameContent = escapeHTML(record.name);
        if (record.difficulty === "custom" && record.customRows) {
            nameContent += ` <span style="font-size: 0.65rem; color: var(--text-muted); margin-left: 4px; border: 1px solid rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 4px;">${record.customRows}x${record.customCols} (🚩${record.customMines})</span>`;
        }

        rowEl.innerHTML = `
            <div class="col-rank">${rankContent}</div>
            <div class="col-name" style="display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameContent}</div>
            <div class="col-status">${statusBadge}</div>
            <div class="col-score monospace text-cyan">${scoreText}</div>
        `;

        leaderboardListEl.appendChild(rowEl);
    });
}

/**
 * XSS 방지를 위한 HTML Escape 헬퍼
 */
function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// =================================================================
// 5. 닉네임 입력 및 유저 세션 관리
// =================================================================

nicknameForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nicknameInput.value.trim();
    if (name.length < 2) return;

    playerName = name;
    currentPlayerNameEl.textContent = name;
    
    // 플레이어의 난이도 선택값 추출
    const selectedDiff = nicknameForm.querySelector('input[name="difficulty"]:checked').value;
    currentGameDifficulty = selectedDiff;
    currentViewDifficulty = selectedDiff; // 플레이하는 난이도의 리더보드를 자동 조회하도록 연동
    setActiveTabUI(selectedDiff);
    
    // 설정에 맞게 가변 격자 크기 및 지뢰 개수 동적 재바인딩
    if (selectedDiff === "custom") {
        const customRows = parseInt(document.getElementById("custom-rows").value, 10);
        const customCols = parseInt(document.getElementById("custom-cols").value, 10);
        const customMines = parseInt(document.getElementById("custom-mines").value, 10);
        
        // 입력값 유효성 검증
        if (isNaN(customRows) || customRows < 5 || customRows > 30) {
            alert("세로 칸수는 5칸에서 30칸 사이로 입력해 주세요.");
            return;
        }
        if (isNaN(customCols) || customCols < 5 || customCols > 30) {
            alert("가로 칸수는 5칸에서 30칸 사이로 입력해 주세요.");
            return;
        }
        if (isNaN(customMines) || customMines < 1 || customMines >= (customRows * customCols)) {
            alert(`지뢰 개수는 1개 이상, 최대 ${(customRows * customCols) - 1}개(가로 x 세로 - 1) 사이로 입력해 주세요.`);
            return;
        }

        // 지뢰 밀도 경고 (전체 칸의 40% 이상이 지뢰일 때)
        const density = customMines / (customRows * customCols);
        if (density >= 0.4) {
            if (!confirm("지뢰가 너무 많습니다. 그래도 시작하시겠습니까?")) {
                return; // 취소 클릭 시 시작 중단
            }
        }
        
        rows = customRows;
        cols = customCols;
        minesCount = customMines;
    } else {
        const config = DIFFICULTY_CONFIG[currentGameDifficulty];
        rows = config.rows;
        cols = config.cols;
        minesCount = config.mines;
    }
    
    // 보드판 전면 재구성
    initBoard();
    renderField();

    // UI 전환
    boardOverlayEl.classList.remove("active");
    playerInfoBar.classList.remove("hidden");
    
    // 게임을 시작 대기("ready") 상태로 만듬 (첫 좌클릭 대기)
    gameState = "ready";
});

// 난이도 라디오 토글 시 커스텀 설정창 제어 이벤트 바인딩
const diffRadios = nicknameForm.querySelectorAll('input[name="difficulty"]');
diffRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
        const customSettingsEl = document.getElementById("custom-settings");
        if (e.target.value === "custom") {
            customSettingsEl.classList.remove("hidden");
        } else {
            customSettingsEl.classList.add("hidden");
        }
    });
});

changeNameBtn.addEventListener("change", () => {
    // 닉네임 변경 버튼 클릭 시 입력창으로 전환
});

changeNameBtn.addEventListener("click", () => {
    playerName = "";
    playerInfoBar.classList.add("hidden");
    nicknameInput.value = "";
    resetGame();
});

restartBtn.addEventListener("click", () => {
    resetGame();
});

modalRestartBtn.addEventListener("click", () => {
    resetGame();
});

// =================================================================
// 6. 숨겨진 개발자 모드 (Hidden Dev Mode) 구현
// =================================================================
let devmodeInputBuffer = "";
const DEVMODE_KEYWORD = "devmode";

// 키보드 입력을 누적 감지하여 개발자 모드 오픈
document.addEventListener("keydown", (e) => {
    // input 포커스 상태일 때는 오작동 방지
    if (document.activeElement.tagName === "INPUT") return;

    // 문자 키 입력만 버퍼에 추가
    if (e.key.length === 1) {
        devmodeInputBuffer += e.key.toLowerCase();
        
        // 버퍼 사이즈를 키워드 길이로 제한
        if (devmodeInputBuffer.length > DEVMODE_KEYWORD.length) {
            devmodeInputBuffer = devmodeInputBuffer.slice(-DEVMODE_KEYWORD.length);
        }

        // 키워드 일치 시 개발자 툴바 보이기
        if (devmodeInputBuffer === DEVMODE_KEYWORD) {
            openDevPanel();
            devmodeInputBuffer = ""; // 버퍼 비우기
        }
    }
});

function openDevPanel() {
    devPanelEl.classList.remove("hidden");
    devPeriodInput.value = leaderboardSettings.resetPeriod;
    console.log("🔓 개발자 모드가 활성화되었습니다!");
}

devCloseBtn.addEventListener("click", () => {
    devPanelEl.classList.add("hidden");
});

// 1) 즉시 리셋 실행
devInstantResetBtn.addEventListener("click", async () => {
    if (confirm("정말로 현재 리더보드에 보이는 모든 실시간 기록들을 즉시 초기화하시겠습니까?\n(Firestore 상에서 물리적 삭제 및 리셋 시간 갱신이 수행됩니다)")) {
        await triggerInstantReset(activeLeaderboardDocIds, leaderboardSettings.resetPeriod);
        alert("리더보드가 즉시 초기화되었습니다.");
    }
});

// 2) 리셋 주기 변경 및 DB 저장
devPeriodApplyBtn.addEventListener("click", async () => {
    const period = parseInt(devPeriodInput.value, 10);
    if (isNaN(period) || period < 1 || period > 1440) {
        alert("1분에서 1440분(24시간) 사이의 유효한 숫자를 입력해 주세요.");
        return;
    }

    await updateResetPeriod(period);
    alert(`리셋 주기가 ${period}분으로 변경 및 DB에 저장되었습니다.`);
});

// =================================================================
// 7. 실시간 DB 리스너 바인딩 및 주기적 만료 청소 타이머
// =================================================================

/**
 * 리더보드 리셋 주기 카운트다운 타이머 갱신
 */
function updateResetCountdown() {
    if (!leaderboardSettings || !leaderboardSettings.nextResetTimestamp) {
        resetTimerTextEl.textContent = "초기화 시간 불러오는 중...";
        return;
    }
    const now = Date.now();
    const nextReset = leaderboardSettings.nextResetTimestamp;
    const timeLeftMs = nextReset - now;

    if (timeLeftMs <= 0) {
        // 리셋 타임이 도달하면 데이터베이스 연동 자동 리셋 실행 (로컬 모드는 자체 갱신)
        const firebaseActive = getFirebaseStatus();
        if (firebaseActive) {
            triggerAutoReset();
        } else {
            triggerLocalAutoReset();
        }
        resetTimerTextEl.textContent = "초기화 진행 중...";
        return;
    }

    const totalSeconds = Math.floor(timeLeftMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let timeStr = "";
    if (hours > 0) {
        timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    } else {
        timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    resetTimerTextEl.textContent = `초기화까지 ${timeStr}`;
}

// 1) Firestore 설정 동기화 구독
listenToSettings((settings) => {
    leaderboardSettings = settings;
    
    // 즉시 카운트다운 타이머 및 리더보드 동기화
    updateResetCountdown();
    filterAndRenderLeaderboard();
});

// 2) Firestore 리더보드 레코드 구독
listenToLeaderboard((records) => {
    rawRecords = records;
    filterAndRenderLeaderboard();
});

// 3) 1초마다 남은 시간 갱신 및 데이터 만료 감지
setInterval(() => {
    updateResetCountdown();
    filterAndRenderLeaderboard();
}, 1000);

// =================================================================
// 8. 앱 구동 개시 및 Firebase 연결 테스트 (Self-Diagnostics)
// =================================================================

async function runFirebaseDiagnostic() {
    await checkFirebaseConnectivity();
}

// 4) 리더보드 탭 클릭 필터 전환 이벤트 등록
const tabContainer = document.getElementById("leaderboard-tabs");
if (tabContainer) {
    tabContainer.addEventListener("click", (e) => {
        const tabBtn = e.target.closest(".tab-btn");
        if (!tabBtn) return;
        
        const diff = tabBtn.dataset.difficulty;
        currentViewDifficulty = diff;
        setActiveTabUI(diff);
        filterAndRenderLeaderboard();
    });
}

/**
 * 리더보드 활성 탭 UI 클래스 추가/제거 헬퍼
 */
function setActiveTabUI(diff) {
    const tabs = document.querySelectorAll(".leaderboard-tabs .tab-btn");
    tabs.forEach((tab) => {
        if (tab.dataset.difficulty === diff) {
            tab.classList.add("active");
        } else {
            tab.classList.remove("active");
        }
    });
}

initBoard();
renderField();
runFirebaseDiagnostic();

console.log("지뢰찾기 게임 모듈 로드 완료. 'devmode'를 입력하면 개발자 메뉴를 실행할 수 있습니다.");
