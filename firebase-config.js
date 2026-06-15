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
    deleteDoc
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
export async function saveRecord(name, cleared, clearTime, correctFlags, difficulty, customRows = null, customCols = null, customMines = null) {
    const recordData = {
        name: name,
        cleared: cleared,
        clearTime: clearTime, // 초 단위
        correctFlags: correctFlags, // 지뢰 위치에 정확히 꽂은 깃발 개수
        difficulty: difficulty || "easy", // 난이도 (easy, medium, hard, custom)
        timestamp: isFirebaseActive ? serverTimestamp() : new Date().toISOString()
    };

    if (difficulty === "custom") {
        recordData.customRows = customRows;
        recordData.customCols = customCols;
        recordData.customMines = customMines;
    }

    if (isFirebaseActive) {
        try {
            await addDoc(collection(db, "leaderboard"), recordData);
            console.log("Firestore 기록 저장 성공:", recordData);
        } catch (error) {
            console.error("Firestore 기록 저장 에러:", error);
        }
    } else {
        // 로컬 스토리지 대체 작동
        const records = getLocalRecords();
        // date string parsing helper
        records.push({
            id: "local_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9),
            ...recordData
        });
        saveLocalRecords(records);
        console.log("로컬 스토리지에 기록 저장 완료 (데모 모드).");
        // 로컬 모드에서는 상태 변경 이벤트를 수동으로 발생시켜 UI 갱신을 도움
        window.dispatchEvent(new CustomEvent("local-db-changed"));
    }
}

/**
 * 2. 리더보드 데이터 실시간 리스너 (onSnapshot)
 * 리포팅 형태는 Array.
 */
export function listenToLeaderboard(callback) {
    if (isFirebaseActive) {
        const q = query(
            collection(db, "leaderboard"),
            orderBy("timestamp", "desc"), // 전체 최근 데이터를 받아와서 클라이언트에서 필터링 & 정렬
            limit(200)
        );
        return onSnapshot(q, (snapshot) => {
            const records = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                // Firestore Timestamp 변환 처리
                let timestampMs = Date.now();
                if (data.timestamp) {
                    timestampMs = data.timestamp instanceof Timestamp ? data.timestamp.toMillis() : data.timestamp.seconds * 1000;
                }
                records.push({
                    id: doc.id,
                    ...data,
                    timestamp: timestampMs
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
                // 로컬의 string date를 ms로 파싱
                timestamp: new Date(r.timestamp).getTime()
            }));
            callback(records);
        };
        // 첫 실행
        triggerUpdate();
        // 커스텀 이벤트 바인딩
        const handler = () => triggerUpdate();
        window.addEventListener("local-db-changed", handler);
        // 구독 해제 핸들러 반환
        return () => window.removeEventListener("local-db-changed", handler);
    }
}

/**
 * 3. 리셋 설정값 (주기 및 수동리셋 기준시각) 실시간 동기화
 */
export function listenToSettings(callback) {
    if (isFirebaseActive) {
        const settingsRef = doc(db, "config", "settings");
        return onSnapshot(settingsRef, async (docSnapshot) => {
            if (!docSnapshot.exists()) {
                // 설정 문서가 없으면 최초 1회 생성 (기본 리셋 60분)
                const defaultSettings = {
                    resetPeriod: 60,
                    lastManualReset: serverTimestamp()
                };
                await setDoc(settingsRef, defaultSettings);
                console.log("기본 설정 문서를 생성했습니다.");
            } else {
                const data = docSnapshot.data();
                let lastResetMs = 0;
                if (data.lastManualReset) {
                    lastResetMs = data.lastManualReset instanceof Timestamp 
                        ? data.lastManualReset.toMillis() 
                        : data.lastManualReset.seconds * 1000;
                }
                callback({
                    resetPeriod: data.resetPeriod || 60,
                    lastManualReset: lastResetMs
                });
            }
        });
    } else {
        // 로컬 데모 모드
        const triggerUpdate = () => {
            const settings = getLocalSettings();
            callback({
                resetPeriod: settings.resetPeriod,
                lastManualReset: new Date(settings.lastManualReset).getTime()
            });
        };
        triggerUpdate();
        const handler = () => triggerUpdate();
        window.addEventListener("local-settings-changed", handler);
        return () => window.removeEventListener("local-settings-changed", handler);
    }
}

/**
 * 4. 개발자 모드: 리셋 주기 설정값 업데이트
 */
export async function updateResetPeriod(newPeriodMinutes) {
    if (isFirebaseActive) {
        const settingsRef = doc(db, "config", "settings");
        try {
            await updateDoc(settingsRef, {
                resetPeriod: newPeriodMinutes
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
 * 5. 개발자 모드: 즉시 리셋 (현재 화면에 노출된 항목 삭제)
 */
export async function triggerInstantReset(visibleDocIds) {
    if (isFirebaseActive) {
        const batch = writeBatch(db);
        
        // 1) 화면에 보이는 활성 데이터들을 Firestore 컬렉션에서 일괄 삭제 (Batch Delete)
        visibleDocIds.forEach((id) => {
            const docRef = doc(db, "leaderboard", id);
            batch.delete(docRef);
        });

        // 2) 설정 문서의 lastManualReset을 현재 시간으로 동기화하여 그 이전 기록도 모두 소멸되게 함
        const settingsRef = doc(db, "config", "settings");
        batch.update(settingsRef, {
            lastManualReset: serverTimestamp()
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

// Firebase 활성화 상태 반환
export function getFirebaseStatus() {
    return isFirebaseActive;
}
