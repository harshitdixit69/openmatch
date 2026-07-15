import fs from 'fs';
import path from 'path';

console.log("==> Verifying Step 8: Decoupled Inbox and Chat Screens...");

const chatScreenPath = path.resolve('src/screens/ChatScreen.tsx');
const mainTabsScreenPath = path.resolve('src/screens/MainTabsScreen.tsx');

if (!fs.existsSync(chatScreenPath)) {
    console.error("❌ ChatScreen.tsx not found!");
    process.exit(1);
}

if (!fs.existsSync(mainTabsScreenPath)) {
    console.error("❌ MainTabsScreen.tsx not found!");
    process.exit(1);
}

const chatScreenContent = fs.readFileSync(chatScreenPath, 'utf8');
const mainTabsScreenContent = fs.readFileSync(mainTabsScreenPath, 'utf8');

// 1. Check isChatScreen prop in ChatScreen
if (!chatScreenContent.includes('isChatScreen?: boolean')) {
    console.error("❌ ChatScreenProps does not include isChatScreen!");
    process.exit(1);
}

// 2. Check ChatListItemCard in ChatScreen
if (!chatScreenContent.includes('function ChatListItemCard')) {
    console.error("❌ ChatListItemCard is not defined in ChatScreen.tsx!");
    process.exit(1);
}

// 3. Check ProfileListItemCard in ChatScreen
if (!chatScreenContent.includes('function ProfileListItemCard')) {
    console.error("❌ ProfileListItemCard is not defined in ChatScreen.tsx!");
    process.exit(1);
}

// 4. Check that ChatScreen is instantiated with isChatScreen={true} and isChatScreen={false} in MainTabsScreen
if (!mainTabsScreenContent.includes('isChatScreen={true}')) {
    console.error("❌ ChatScreen is not instantiated with isChatScreen={true} in MainTabsScreen.tsx!");
    process.exit(1);
}

if (!mainTabsScreenContent.includes('isChatScreen={false}')) {
    console.error("❌ ChatScreen is not instantiated with isChatScreen={false} in MainTabsScreen.tsx!");
    process.exit(1);
}

console.log("✅ Step 8 structural and code decoupling verified successfully!");
