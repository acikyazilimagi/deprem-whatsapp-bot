import { Boom } from '@hapi/boom'
import makeWASocket, { AnyMessageContent, delay, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, MessageRetryMap, useMultiFileAuthState } from '@adiwajshing/baileys'
import MAIN_LOGGER  from "./functions/logger";
import axios from 'axios';
import url from 'url';
import { MongoClient } from 'mongodb'


// MongoDB Connection
const uri = 'yourmongoconnectionstring'

const client = new MongoClient(uri);
// MongoDB Database
const db = client.db("alanlar");


const logger = MAIN_LOGGER.child({ })

logger.level = 'trace'

const useStore = !process.argv.includes('--no-store')
const doReplies = !process.argv.includes('--no-reply')

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterMap: MessageRetryMap = { }

// the store maintains the data of the WA connection in memory
// can be written out to a file & read from it
const store = useStore ? makeInMemoryStore({ logger }) : undefined
store?.readFromFile('./baileys_store_multi.json')
// save every 10s
setInterval(() => {
	store?.writeToFile('./baileys_store_multi.json')
}, 10_000)

// start a connection
const startSock = async() => {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	const sock = makeWASocket({
		version,
		logger,
		printQRInTerminal: true,
		auth: state,
		msgRetryCounterMap,
		// implement to handle retries
		getMessage: async key => {
			if(store) {
				const msg = await store.loadMessage(key.remoteJid!, key.id!, undefined)
				return msg?.message || undefined
			}

			// only if store is present
			return {
				conversation: 'testtesttesttesttesttest'
			}
		}
	})

	store?.bind(sock.ev)

	// the process function lets you process all events that just occurred
	// efficiently in a batch
	sock.ev.process(
		// events is a map for event name => event data
		async(events) => {
			// something about the connection changed
			// maybe it closed, or we received all offline message or connection opened
			if(events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect } = update
				if(connection === 'close') {
					// reconnect if not logged out
					if((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
						startSock()
					} else {
						console.log('Connection closed. You are logged out.')
					}
				}

				console.log('connection update', update)
			}

			// credentials updated -- save them
			if(events['creds.update']) {
				await saveCreds()
			}

			// received a new message
			if(events['messages.upsert']) {
				const upsert = events['messages.upsert']

				if(upsert.type === 'notify') {
					for(const msg of upsert.messages) {
						if(!msg.key.fromMe && doReplies) {
							if (msg.message?.conversation || msg.message?.extendedTextMessage?.text){

								const sesdoc = { id: msg.key.remoteJid!};
								const sesresult = await db.collection("session").findOne(sesdoc);

								if (!sesresult)
								{
									const doc = { id: msg.key.remoteJid!, last_message: "", date: new Date() };
									const result = await db.collection("session").insertOne(doc);
								}

								await sock.sendMessage(msg.key.remoteJid!, { text: '🚨 Yanındayım Destek Botu 🚨' })
								
								const sections = [
									{
									title: "Acil Durum Seçenekleri",
									rows: [
										{title: " 🆘 En Yakın Toplanma ve Acil Durum Yerleri (Türkiye Geneli)", rowId: "option1", description: "E-Devlet entegrasyonu ile lokasyonunuza en yakın toplanma noktaları size konum olarak gelecektir."},
										{title: "🚨 Ahbap Derneği, Afet Konaklama ve Güvenli Bölgeleri (Sadece Afet Bölgeleri)", rowId: "option2", description: "Ahbap derneği entegrasyonu ile lokasyonunuza en yakın acil durum noktaları size konum olarak gelecektir."},
										{title: "🩸 Kızılay Kan Bağış Noktaları (Türkiye Geneli)", rowId: "option3", description: "Kızılay entegrasyonu ile lokasyonunuza en yakın kan bağışı noktaları size konum olarak gelecektir."},
										{title: "💊 Sahra Konteyner Eczaneler (Sadece Afet Bölgeleri)", rowId: "option4", description: "Lokasyonunuza en yakın sahra konteyner eczane noktaları size konum olarak gelecektir."}

									]
									},
								]
								
								const listMessage = {
								  text: "İhtiyacınız olan hizmeti seçeneklerden seçerek kullabilirsiniz",
								  footer: "*Önemli Not*: Kişisel verileriniz hiç bir kurum ile paylaşılmamaktadır. \r\n\r\nVeriler 30 dakikada bir olmak üzere güncellenmektedir.",
								  title: "🚨 Yanındayım Afet Destek 🚨",
								  buttonText: "Acil Durum Seçenekleri",
								  sections
								}
								
								const sendMsg = await sock.sendMessage(msg.key.remoteJid!, listMessage)
							}

							if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId == "option1")
							{
								const replacement  = { id: msg.key.remoteJid!, last_message: "edevlet", date: new Date() };
								const query  = { id: msg.key.remoteJid! };

								const result = await db.collection("session").replaceOne(query, replacement);
								if (result)
								{
									await sock.sendMessage(msg.key.remoteJid!, { text: '📍 Size en yakın bölgeleri sunabilmemiz adına lütfen konumunuzu gönderiniz.' })
								}
								else
								{
									await sock.sendMessage(msg.key.remoteJid!, { text: 'Bir hata ile karşılaşıldı. Çok üzgünüz :(' })
								}
								
							}

							if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId == "option2")
							{
								const replacement  = { id: msg.key.remoteJid!, last_message: "ahbap", date: new Date() };
								const query  = { id: msg.key.remoteJid! };

								const result = await db.collection("session").replaceOne(query, replacement);
								if (result)
								{
									await sock.sendMessage(msg.key.remoteJid!, { text: '📍 Size en yakın bölgeleri sunabilmemiz adına lütfen konumunuzu gönderiniz.' })
								}
								else
								{
									await sock.sendMessage(msg.key.remoteJid!, { text: 'Bir hata ile karşılaşıldı. Çok üzgünüz :(' })
								}
							}

							if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId == "option3")
							{
								const replacement  = { id: msg.key.remoteJid!, last_message: "kanbagis", date: new Date() };
								const query  = { id: msg.key.remoteJid! };

								const result = await db.collection("session").replaceOne(query, replacement);
								if (result)
								{
									await sock.sendMessage(msg.key.remoteJid!, { text: '📍 Size en yakın bölgeleri sunabilmemiz adına lütfen konumunuzu gönderiniz.' })
								}
								else
								{
									await sock.sendMessage(msg.key.remoteJid!, { text: 'Bir hata ile karşılaşıldı. Çok üzgünüz :(' })
								}
							}

							if (msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId == "option4")
							{
								const replacement  = { id: msg.key.remoteJid!, last_message: "eczane", date: new Date() };
								const query  = { id: msg.key.remoteJid! };

								const result = await db.collection("session").replaceOne(query, replacement);
								if (result)
								{
									await sock.sendMessage(msg.key.remoteJid!, { text: '📍 Size en yakın bölgeleri sunabilmemiz adına lütfen konumunuzu gönderiniz.' })
								}
								else
								{
									await sock.sendMessage(msg.key.remoteJid!, { text: 'Bir hata ile karşılaşıldı. Çok üzgünüz :(' })
								}
							}

							if (msg.message?.locationMessage){
								const sesdoc = { id: msg.key.remoteJid!};
								const sesresult = await db.collection("session").findOne(sesdoc);

								const datason = JSON.stringify(sesresult, undefined, 2)
								const obj = JSON.parse(datason);

								if (sesresult)
								{
									if (obj.last_message == "edevlet")
									{
										axios.all([
											axios.get('https://www.turkiye.gov.tr/afet-ve-acil-durum-yonetimi-acil-toplanma-alani-sorgulama?harita=goster')
										  ]).then(axios.spread((response) => {
											var cookies = response.headers['set-cookie'];
											var TURKIYESESSIONID = parse(String(cookies),"TURKIYESESSIONID=",";");
											var w3p = parse(String(cookies),"w3p=",";");
											var token = parse(String(response.data),'data-token="','"');
		
											const latitude = msg.message?.locationMessage?.degreesLatitude
											const longutide = msg.message?.locationMessage?.degreesLongitude
		
											axios.post('https://www.turkiye.gov.tr/afet-ve-acil-durum-yonetimi-acil-toplanma-alani-sorgulama?harita=goster&submit', new url.URLSearchParams({
												pn: '/afet-ve-acil-durum-yonetimi-acil-toplanma-alani-sorgulama',
												ajax: '1',
												token: token,
												islem: 'getAlanlarForNokta',
												lat: String(latitude),
												lng: String(longutide),
											  }),
											  {
												headers: {
													'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
													'Cookie': 'TURKIYESESSIONID=' + TURKIYESESSIONID + '; language=tr_TR.UTF-8; w3p=' + w3p + ';',
													'X-Requested-With': 'XMLHttpRequest'
												}
											  }
											  )
											  .then(async (response) => {
												if (response?.data?.features?.length > 0) {
													var features = response.data.features;
												
													for (var i = 0; i < features.length; i++) {
														var feature = features[i];
													
														var sokak = feature.properties.sokak_adi;
														var name = feature.properties.tesis_adi;
													
														if (sokak == null) {
															sokak = "-";
														}
														if (name == null) {
															name = "-";
														}
													
														var sehir = feature.properties.il_adi;
														var ilce = feature.properties.ilce_adi;
														var mahalle = feature.properties.mahalle_adi;
													
														var koordinatlar = feature.geometry.coordinates[0];
														var adres = sokak + ", " + mahalle + ", " + ilce + "/" + sehir;
		
														await sock.sendMessage(msg.key.remoteJid!, { location: { degreesLatitude: koordinatlar[0][1], degreesLongitude: koordinatlar[0][0], address: adres, name: name } })
													}
		
													delay(2000)
													await sock.sendMessage(msg.key.remoteJid!, { text: "Hayatını kaybeden vatandaşlarımıza Allah'tan rahmet, yaralılara acil şifalar, yakınlarına sabır ve başsağlığı diliyoruz.\r\n\r\n*Devam etmek için sohbete herhangi bir şey yazabilirsiniz.*  \r\n\r\n *Yanındayım Ekibi*" })
												}
												else
												{
													await sock.sendMessage(msg.key.remoteJid!, { text: 'Bir hata ile karşılaşıldı. E-Devlet sunucuları yanıt vermiyor. Çok üzgünüz :('  })
												}
					
											  }, async (error) => {
												await sock.sendMessage(msg.key.remoteJid!, { text: 'Bir hata ile karşılaşıldı. E-Devlet sunucuları yanıt vermiyor. Çok üzgünüz :(, Hata:' + error })
											  });
		
										  })).catch(async error => {
											await sock.sendMessage(msg.key.remoteJid!, { text: 'Bir hata ile karşılaşıldı. E-Devlet sunucuları yanıt vermiyor. Çok üzgünüz :(, Hata:' + error })
										});
									}
									else if (obj.last_message == "ahbap")
									{
										const latitude = msg.message?.locationMessage?.degreesLatitude
										const longutide = msg.message?.locationMessage?.degreesLongitude
										
										const dataa = db.collection("alanlar").aggregate([{
											$geoNear: {
												near: {
													type: "Point",
													coordinates: [longutide,latitude]													
												},
												distanceField: "dist.calculated",
												maxDistance: 2000000000000,
												query: {
													type: "Feature"
												},
												spherical: true
											}
										},{ $limit: 5 }])
	
										for await (const doc of dataa) {
											const datason = JSON.stringify(doc, undefined, 2)
											const obj = JSON.parse(datason);

											const km = obj.dist.calculated / 1000;
											const kmfix = km.toFixed(1) + " km";
	
											if (String(obj.properties.styleMapHash.normal) == "#icon-1826-0288D1-nodesc-normal")
											{
												if (obj.properties.description)
												{
													await sock.sendMessage(msg.key.remoteJid!, { location: { degreesLatitude: obj.geometry.coordinates[1], degreesLongitude: obj.geometry.coordinates[0], address: "Ahbap: Güvenli Nokta \r\n\r\n / " + obj.properties.description + " / Uzaklık: " + kmfix, name: obj.properties.name } })
												}
												else
												{
													await sock.sendMessage(msg.key.remoteJid!, { location: { degreesLatitude: obj.geometry.coordinates[1], degreesLongitude: obj.geometry.coordinates[0], address: "Ahbap: Güvenli Nokta" + " / Uzaklık: " + kmfix, name: obj.properties.name } })
												}
											}
											else if (String(obj.properties.styleMapHash.normal) == "#icon-1602-FF5252-nodesc-normal"  || String(obj.properties.styleMapHash.normal) == "#icon-1577-7CB342-normal")
											{
												if (obj.properties.description)
												{
													await sock.sendMessage(msg.key.remoteJid!, { location: { degreesLatitude: obj.geometry.coordinates[1], degreesLongitude: obj.geometry.coordinates[0], address: "Ahbap: Konaklama - Beslenme / " + obj.properties.description + " / Uzaklık: " + kmfix, name: obj.properties.name } })
												}
												else
												{
													await sock.sendMessage(msg.key.remoteJid!, { location: { degreesLatitude: obj.geometry.coordinates[1], degreesLongitude: obj.geometry.coordinates[0], address: "Ahbap: Konaklama - Beslenme" + " / Uzaklık: " + kmfix, name: obj.properties.name } })
												}
												
											}
											
										}
	
										delay(2000)
										await sock.sendMessage(msg.key.remoteJid!, { text: "Hayatını kaybeden vatandaşlarımıza Allah'tan rahmet, yaralılara acil şifalar, yakınlarına sabır ve başsağlığı diliyoruz.\r\n\r\n*Devam etmek için sohbete herhangi bir şey yazabilirsiniz.*  \r\n\r\n *Yanındayım Ekibi*" })
									}
									else if (obj.last_message == "kanbagis")
									{
									    const latitude = msg.message?.locationMessage?.degreesLatitude
									    const longutide = msg.message?.locationMessage?.degreesLongitude
									
									    const dataa = db.collection("kanbagisi").aggregate([{
									        $geoNear: {
									            near: {
									                type: "Point",
									                coordinates: [longutide,latitude]													
									            },
									            distanceField: "dist.calculated",
									            maxDistance: 2000000000000,
									            query: {
									                type: "Feature"
									            },
									            spherical: true
									        }
									    },{ $limit: 3 }])
									
									    for await (const doc of dataa) {
									        const datason = JSON.stringify(doc, undefined, 2)
									        const obj = JSON.parse(datason);
										
									        const km = obj.dist.calculated / 1000;
									        const kmfix = km.toFixed(1) + " km";
										
									        await sock.sendMessage(msg.key.remoteJid!, { location: { degreesLatitude: obj.geometry.coordinates[1], degreesLongitude: obj.geometry.coordinates[0], address: obj.properties.adres + " / Uzaklık: " + kmfix, name: obj.properties.ekipAdi } })
											await sock.sendMessage(msg.key.remoteJid!, { text: "*Kan Bağış Noktası Bilgileri*" + "\r\n\r\n" + "İletişim Telefon No: " + obj.properties.telefon + "\r\n" + "Başlama Saati: " + new Date(obj.properties.baslangicSaati).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) + "\r\n" + "Ara Saati: " + new Date(obj.properties.araBaslangicSaati).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) + "-" + new Date(obj.properties.araBitisSaati).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) + "\r\n" + "Bitiş Saati: " + new Date(obj.properties.bitisSaati).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false})})
									    }
									
									    delay(2000)
									    await sock.sendMessage(msg.key.remoteJid!, { text: "Hayatını kaybeden vatandaşlarımıza Allah'tan rahmet, yaralılara acil şifalar, yakınlarına sabır ve başsağlığı diliyoruz.\r\n\r\n*Devam etmek için sohbete herhangi bir şey yazabilirsiniz.*  \r\n\r\n *Yanındayım Ekibi*" })
									}
									else if (obj.last_message == "eczane")
									{
									    const latitude = msg.message?.locationMessage?.degreesLatitude
									    const longutide = msg.message?.locationMessage?.degreesLongitude

									    const dataaa = db.collection("eczaneler").aggregate([{
											$geoNear: {
												near: {
													type: "Point",
													coordinates: [Number(longutide),Number(latitude)]	
												},
												distanceField: "dist.calculated",
												maxDistance: 20000000000000,
												query: {
													type: "Feature"
												},
												spherical: true
											}
									    },{ $limit: 3 }])
									
									    for await (const doc of dataaa) {
									        const datason = JSON.stringify(doc, undefined, 2)
									        const obj = JSON.parse(datason);
										
									        const km = obj.dist.calculated / 1000;
									        const kmfix = km.toFixed(1) + " km";
										
									        await sock.sendMessage(msg.key.remoteJid!, { location: { degreesLatitude: obj.geometry.coordinates[1], degreesLongitude: obj.geometry.coordinates[0], address: obj.properties.name + " / Uzaklık: " + kmfix, name: obj.properties.description } })
									    }
									
									    delay(2000)
									    await sock.sendMessage(msg.key.remoteJid!, { text: "Hayatını kaybeden vatandaşlarımıza Allah'tan rahmet, yaralılara acil şifalar, yakınlarına sabır ve başsağlığı diliyoruz.\r\n\r\n*Devam etmek için sohbete herhangi bir şey yazabilirsiniz.*  \r\n\r\n *Yanındayım Ekibi*" })
									}
								}
								else
								{
									await sock.sendMessage(msg.key.remoteJid!, { text: 'Lütfen botu *Başlat* mesajı ile başlatınız' })
								}
							}
						}
					}
				}
			}
		}
	)

	return sock
}

function parse(source: string, left: string, right: string) {
    //left,right parser
    return source.split(left)[1].split(right)[0];
}


startSock()
