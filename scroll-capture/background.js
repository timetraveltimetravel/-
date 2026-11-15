// 아이콘을 누르면 측면 패널을 연다.
// 아이콘을 누르는 동작이 현재 탭에 대한 캡처 권한(activeTab)을 준다.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
