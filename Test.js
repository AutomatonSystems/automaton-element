import express from 'express';

import puppeteer from 'puppeteer';

(async () => {

	const server = express();
	server.use(express.static('.'));
	server.listen(3000, () => console.log('Express listening on port 3000!'));

	const browser = await puppeteer.launch({args: ['--disable-web-security', '--disable-infobars'], headless: false});
	const page = await browser.newPage();
	const url = 'localhost:3000/Test.html';
	await page.goto(url);
})();