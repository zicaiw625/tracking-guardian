
/* eslint-env node */

import fs from 'fs';
import path from 'path';

const enPath = path.join(process.cwd(), 'app/locales/en.json');
const zhPath = path.join(process.cwd(), 'app/locales/zh.json');

const newKeysEn = {
    "errorCode": "Error Code:",
    "backToHome": "Back to Home",
    "reload": "Reload",
    "loadFailed": "Load Failed",
    "loadDataError": "Error loading data",
    "unexpectedError": "Sorry, an unexpected error occurred. Our team has been notified.",
    "http": {
      "400": { "title": "Bad Request", "message": "Your request format is incorrect, please check and try again." },
      "401": { "title": "Unauthorized", "message": "You need to log in to access this page." },
      "403": { "title": "Access Denied", "message": "You do not have permission to access this resource." },
      "404": { "title": "Page Not Found", "message": "The page you are looking for does not exist or has been removed." },
      "429": { "title": "Too Many Requests", "message": "Your requests are too frequent, please try again later." },
      "500": { "title": "Server Error", "message": "Internal server error, please try again later." },
      "502": { "title": "Gateway Error", "message": "Service temporarily unavailable, please try again later." },
      "503": { "title": "Service Unavailable", "message": "Service is under maintenance, please try again later." },
      "504": { "title": "Gateway Timeout", "message": "Request timed out, please check your network connection and try again." }
    }
};

const newKeysZh = {
    "errorCode": "错误代码:",
    "backToHome": "返回首页",
    "reload": "重新加载",
    "loadFailed": "加载失败",
    "loadDataError": "加载数据时发生错误",
    "unexpectedError": "抱歉，发生了意外错误。我们的团队已收到通知。",
    "http": {
      "400": { "title": "请求无效", "message": "您的请求格式不正确，请检查后重试。" },
      "401": { "title": "未授权", "message": "您需要登录才能访问此页面。" },
      "403": { "title": "访问被拒绝", "message": "您没有权限访问此资源。" },
      "404": { "title": "页面未找到", "message": "您访问的页面不存在或已被移除。" },
      "429": { "title": "请求过于频繁", "message": "您的请求过于频繁，请稍后再试。" },
      "500": { "title": "服务器错误", "message": "服务器发生内部错误，请稍后重试。" },
      "502": { "title": "网关错误", "message": "服务暂时不可用，请稍后重试。" },
      "503": { "title": "服务不可用", "message": "服务正在维护中，请稍后重试。" },
      "504": { "title": "网关超时", "message": "请求超时，请检查网络连接后重试。" }
    }
};

const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const zhData = JSON.parse(fs.readFileSync(zhPath, 'utf8'));

Object.assign(enData.errorPage, newKeysEn);
Object.assign(zhData.errorPage, newKeysZh);

fs.writeFileSync(enPath, JSON.stringify(enData, null, 2));
fs.writeFileSync(zhPath, JSON.stringify(zhData, null, 2));

console.log('Translations updated.');
