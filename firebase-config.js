// =================================================================
// [FIREBASE CONFIGURATION PLACEHOLDER]
// 이곳에 본인의 Firebase Firestore 프로젝트 키를 입력해 주세요.
// =================================================================
const firebaseConfig = {
    apiKey: "AIzaSyBDJE9CoS_N8fdtqgHYwDMWPGkFuCIj5zo",
    authDomain: "minsukim-database-72105.firebaseapp.com",
    projectId: "minsukim-database-72105",
    storageBucket: "minsukim-database-72105.firebasestorage.app",
    messagingSenderId: "532092657612",
    appId: "1:532092657612:web:a2f8cfb62deb71ce6d4769",
    measurementId: "G-EZ9Z5RVM9J"
};

// =================================================================
// Firebase Modules Import (CDN ES Modules Version 10)
// =================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    onSnapshot, 
    query, 
    orderBy, 
    limit, 
    doc, 
    getDoc,
    setDoc, 
    updateDoc, 
    writeBatch, 
    serverTimestamp,
    Timestamp,
    deleteDoc,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let db = null;
let isFirebaseActive = false;

// Firebase Config 유효성 검사 및 초기화
const isConfigValid = firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";

if (isConfigValid) {
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        // connectivity 함수에서 최종 검증을 할 것이므로 일단 인스턴스 할당
        console.log("Firebase 인스턴스가 생성되었습니다. 연결 상태를 진단합니다...");
    } catch (e) {
        console.error("Firebase 초기화 중 에러가 발생했습니다: ", e);
    }
} else {
    console.warn("유효한 firebaseConfig가 제공되지 않았습니다. 데모 모드(로컬 저장소)로 가동됩니다. 실시간 기능을 사용하려면 firebase-config.js 파일에 Firestore 키를 설정하세요.");
}

/**
 * Firestore 연동 테스트 및 자가 진단 함수
 */
export async function checkFirebaseConnectivity() {
    if (!isConfigValid || !db) {
        isFirebaseActive = false;
        return false;
    }
    try {
        // 3초 타임아웃을 건 Firestore 문서 가져오기 시도
        const settingsRef = doc(db, "config", "settings");
        const promise = getDoc(settingsRef);
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000));
        
        await Promise.race([promise, timeout]);
        isFirebaseActive = true;
        console.log("Firebase Firestore가 성공적으로 연동되었습니다 (연동 테스트 완료).");
        return true;
    } catch (e) {
        console.error("Firebase 연동 테스트 실패 (오프라인/설정 오류):", e);
        isFirebaseActive = false;
        return false;
    }
}

// =================================================================
// Local Storage Fallback System (개발/데모 목적용 로컬 랭킹 모드)
// =================================================================
const LOCAL_STORAGE_KEY = "minesweeper_local_leaderboard";
const LOCAL_SETTINGS_KEY = "minesweeper_local_settings";

const getLocalRecords = () => {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "[]");
};

const saveLocalRecords = (records) => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
};

const getLocalSettings = () => {
    const defaultSettings = {
        resetPeriod: 60, // 60분 (1시간)
        lastManualReset: new Date().toISOString()
    };
    const settings = localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (!settings) {
        localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(defaultSettings));
        return defaultSettings;
    }
    return JSON.parse(settings);
};

const saveLocalSettings = (settings) => {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
};

// =================================================================
// 데이터베이스(Firestore / LocalStorage) 인터페이스 함수들
// =================================================================

/**
 * 1. 게임 전적 데이터(기록) 추가
 */
export async function saveRecord(name, cleared, clearTime, correctFlags, difficulty, customRows = null, customMines = null, customCols = null) {
    const recordData = {
        name: name,
        cleared: cleared,
        clearTime: clearTime, // 초 단위
        correctFlags: correctFlags, // 지뢰 위치에 정확히 꽂은 깃발 개수
        difficulty: difficulty || "easy", // 난이도 (easy, medium, hard, custom)
        timestamp: db ? serverTimestamp() : new Date().toISOString()
    };

    if (difficulty === "custom") {
        recordData.customRows = customRows;
        recordData.customCols = customCols;
        recordData.customMines = customMines;
    }

    if (db) {
        try {
            await addDoc(collection(db, "leaderboard"), recordData);
            console.log("Firestore 기록 저장 성공:", recordData);
        } catch (error) {
            console.error("Firestore 기록 저장 에러:", error);
        }
    } else {
        // 로컬 스토리지 대체 작동
        const records = getLocalRecords();
        records.push({
            id: "local_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9),
            ...recordData
        });
        saveLocalRecords(records);
        console.log("로컬 스토리지에 기록 저장 완료 (데모 모드).");
        window.dispatchEvent(new CustomEvent("local-db-changed"));
    }
}

/**
 * 2. 리더보드 데이터 실시간 리스너 (onSnapshot)
 */
export function listenToLeaderboard(callback) {
    if (db) {
        const q = query(
            collection(db, "leaderboard"),
            orderBy("timestamp", "desc"), // 전체 최근 데이터를 받아와서 클라이언트에서 필터링 & 정렬
            limit(200)
        );
        return onSnapshot(q, (snapshot) => {
            const records = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                let timestampMs = Date.now();
                if (data.timestamp) {
                    if (typeof data.timestamp.toMillis === "function") {
                        timestampMs = data.timestamp.toMillis();
                    } else if (data.timestamp.seconds) {
                        timestampMs = data.timestamp.seconds * 1000;
                    } else {
                        timestampMs = new Date(data.timestamp).getTime() || Date.now();
                    }
                }
                records.push({
                    id: doc.id,
                    ...data,
                    timestamp: timestampMs,
                    isPending: !data.timestamp || (doc.metadata && doc.metadata.hasPendingWrites)
                });
            });
            callback(records);
        }, (error) => {
            console.error("리더보드 구독 실패:", error);
        });
    } else {
        // 로컬 데모 구독 시뮬레이션
        const triggerUpdate = () => {
            const records = getLocalRecords().map(r => ({
                ...r,
                timestamp: new Date(r.timestamp).getTime()
            }));
            callback(records);
        };
        triggerUpdate();
        const handler = () => triggerUpdate();
        window.addEventListener("local-db-changed", handler);
        return () => window.removeEventListener("local-db-changed", handler);
    }
}

/**
 * 3. 리셋 설정값 (주기 및 수동리셋 기준시각) 실시간 동기화 (자동 주기 리셋 스키마 포함)
 */
export function listenToSettings(callback) {
    if (db) {
        const settingsRef = doc(db, "config", "settings");
        return onSnapshot(settingsRef, async (docSnapshot) => {
            if (!docSnapshot.exists()) {
                // 설정 문서가 없으면 최초 1회 생성 (기본 리셋 60분)
                const now = Date.now();
                const periodMs = 60 * 60 * 1000; // 60분
                const defaultSettings = {
                    resetPeriod: 60,
                    lastManualReset: serverTimestamp(),
                    lastSystemReset: serverTimestamp(),
                    nextResetTimestamp: Timestamp.fromMillis(now + periodMs)
                };
                await setDoc(settingsRef, defaultSettings);
                console.log("기본 설정 문서를 생성했습니다.");
            } else {
                const data = docSnapshot.data();
                
                const parseTimestamp = (val) => {
                    if (!val) return 0;
                    if (typeof val.toMillis === "function") return val.toMillis();
                    if (val.seconds) return val.seconds * 1000;
                    return new Date(val).getTime() || 0;
                };

                const lastManualResetMs = parseTimestamp(data.lastManualReset);
                const lastSystemResetMs = parseTimestamp(data.lastSystemReset);
                const nextResetMs = parseTimestamp(data.nextResetTimestamp) || (Date.now() + 60 * 60 * 1000);

                callback({
                    resetPeriod: data.resetPeriod || 60,
                    lastManualReset: lastManualResetMs,
                    lastSystemReset: lastSystemResetMs,
                    nextResetTimestamp: nextResetMs
                });
            }
        });
    } else {
        // 로컬 데모 모드
        const triggerUpdate = () => {
            const settings = getLocalSettings();
            const now = Date.now();
            const lastManual = new Date(settings.lastManualReset).getTime();
            const periodMs = settings.resetPeriod * 60 * 1000;
            const elapsed = now - lastManual;
            const cycles = Math.floor(elapsed / periodMs);
            const nextReset = lastManual + (cycles + 1) * periodMs;
            const lastSystem = lastManual + cycles * periodMs;

            callback({
                resetPeriod: settings.resetPeriod,
                lastManualReset: lastManual,
                lastSystemReset: lastSystem,
                nextResetTimestamp: nextReset
            });
        };
        triggerUpdate();
        const handler = () => triggerUpdate();
        window.addEventListener("local-settings-changed", handler);
        return () => window.removeEventListener("local-settings-changed", handler);
    }
}

/**
 * 4. 개발자 모드: 리셋 주기 설정값 업데이트 (데이터베이스 연동으로 다음 리셋 타임도 동시 재계산)
 */
export async function updateResetPeriod(newPeriodMinutes) {
    if (db) {
        const settingsRef = doc(db, "config", "settings");
        const now = Date.now();
        const nextReset = now + newPeriodMinutes * 60 * 1000;
        try {
            await updateDoc(settingsRef, {
                resetPeriod: newPeriodMinutes,
                lastSystemReset: serverTimestamp(),
                nextResetTimestamp: Timestamp.fromMillis(nextReset)
            });
            console.log(`리셋 주기가 ${newPeriodMinutes}분으로 업데이트 되었습니다.`);
        } catch (error) {
            console.error("리셋 주기 설정 변경 에러:", error);
        }
    } else {
        const settings = getLocalSettings();
        settings.resetPeriod = newPeriodMinutes;
        saveLocalSettings(settings);
        console.log(`[로컬] 리셋 주기가 ${newPeriodMinutes}분으로 변경되었습니다.`);
        window.dispatchEvent(new CustomEvent("local-settings-changed"));
    }
}

/**
 * 5. 개발자 모드: 즉시 리셋 (현재 화면에 노출된 항목 삭제 및 시간 동시 동기화)
 */
export async function triggerInstantReset(visibleDocIds, resetPeriod = 60) {
    if (db) {
        const batch = writeBatch(db);
        
        // 1) 화면에 보이는 활성 데이터들을 Firestore 컬렉션에서 일괄 삭제 (Batch Delete)
        visibleDocIds.forEach((id) => {
            const docRef = doc(db, "leaderboard", id);
            batch.delete(docRef);
        });

        // 2) 설정 문서의 lastManualReset 및 lastSystemReset을 현재 시간으로 세팅
        const settingsRef = doc(db, "config", "settings");
        const now = Date.now();
        const nextReset = now + resetPeriod * 60 * 1000;
        batch.update(settingsRef, {
            lastManualReset: serverTimestamp(),
            lastSystemReset: serverTimestamp(),
            nextResetTimestamp: Timestamp.fromMillis(nextReset)
        });

        try {
            await batch.commit();
            console.log("즉시 리셋을 실행하여 활성 문서 삭제 및 리셋 시간 갱신이 완료되었습니다.");
        } catch (error) {
            console.error("즉시 리셋 실행 에러:", error);
        }
    } else {
        // 로컬 데모 모드: 로컬 스토리지의 모든 레코드 비우기 및 settings.lastManualReset 갱신
        const settings = getLocalSettings();
        settings.lastManualReset = new Date().toISOString();
        saveLocalSettings(settings);
        
        // 화면에 노출되었던 로컬 데이터 삭제
        let records = getLocalRecords();
        records = records.filter(r => !visibleDocIds.includes(r.id));
        saveLocalRecords(records);

        console.log("[로컬] 리더보드 데이터 즉시 초기화 완료.");
        window.dispatchEvent(new CustomEvent("local-db-changed"));
        window.dispatchEvent(new CustomEvent("local-settings-changed"));
    }
}

/**
 * 6. 자동 리셋 트리거 (카운트다운 만료 시 트랜잭션을 사용하여 동시 안전 초기화 실행)
 */
export async function triggerAutoReset() {
    if (!db) return;
    const settingsRef = doc(db, "config", "settings");
    try {
        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(settingsRef);
            if (!sfDoc.exists()) return;
            
            const data = sfDoc.data();
            let nextResetMs = data.nextResetTimestamp instanceof Timestamp 
                ? data.nextResetTimestamp.toMillis() 
                : data.nextResetTimestamp.seconds * 1000;
            
            const now = Date.now();
            // 만약 이미 다른 사용자가 리셋을 완료해서 nextResetTimestamp가 미래 시점으로 갱신되었으면 스킵
            if (now < nextResetMs) {
                return;
            }
            
            const periodMs = (data.resetPeriod || 60) * 60 * 1000;
            let newNextMs = nextResetMs + periodMs;
            // 누적 미처리 주기가 있는 경우 현재 시간 이후로 반복 연산
            while (newNextMs <= now) {
                newNextMs += periodMs;
            }
            
            transaction.update(settingsRef, {
                lastSystemReset: Timestamp.fromMillis(nextResetMs),
                nextResetTimestamp: Timestamp.fromMillis(newNextMs)
            });
            console.log(`[Firestore 트랜잭션] 자동 동시 리셋 성공. 다음 리셋: ${new Date(newNextMs).toLocaleString()}`);
        });
    } catch (error) {
        console.error("자동 리셋 트랜잭션 실패:", error);
    }
}

/**
 * 7. 로컬 데모 모드를 위한 자동 리셋 시뮬레이션
 */
export function triggerLocalAutoReset() {
    const settings = getLocalSettings();
    const now = Date.now();
    const lastManual = new Date(settings.lastManualReset).getTime();
    const periodMs = settings.resetPeriod * 60 * 1000;
    const elapsed = now - lastManual;
    const cycles = Math.floor(elapsed / periodMs);
    settings.lastManualReset = new Date(lastManual + (cycles + 1) * periodMs).toISOString();
    saveLocalSettings(settings);
    window.dispatchEvent(new CustomEvent("local-settings-changed"));
}

// Firebase 활성화 상태 반환
export function getFirebaseStatus() {
    return isFirebaseActive;
}
