/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { onRequest } = require("firebase-functions/v2/https");
// const logger = require("firebase-functions/logger");

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

const admin = require("firebase-admin");
const functions = require("firebase-functions");
const { getStorage, getDownloadURL } = require("firebase-admin/storage");
const { GeoPoint, Timestamp } = require("firebase-admin/firestore");

const axios = require("axios");
const geolib = require("geolib");
const { DateTime } = require("luxon");
const excelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const os = require("os");
const cron = require("node-cron");
const crypto = require("crypto");

const { Telegraf, Markup, session } = require("telegraf");
const { message } = require("telegraf/filters");
const bot = new Telegraf(functions.config().telegrambot.key);

// bot.use(session());

// bot.use((ctx, next) => {
//   if (!ctx.session) {
//     ctx.session = {}; // Inisialisasi objek sesi jika tidak ada
//   }
//   return next(); // Melanjutkan ke middleware berikutnya
// });

const vision = require("@google-cloud/vision");
const clientVision = new vision.ImageAnnotatorClient();

const service_account = require("./attendiq-180f1-firebase-adminsdk-v7e53-cf1cd3b028.json");

// admin.initializeApp({
//   credential: admin.credential.cert(service_account),
// });

admin.initializeApp();

const bucket = getStorage().bucket();
const db = admin.firestore();

exports.userDeleted = functions.auth.user().onDelete((user) => {
  try {
    return admin.firestore().collection("users").doc(user.uid).delete();
  } catch (error) {
    console.error("Error deleting user : ", error);
  }
});

exports.updateCompanyName = functions.firestore
  .document("users/{userId}")
  .onUpdate(async (change, context) => {
    try {
      const before_data = change.before.data();
      const after_data = change.after.data();

      if (before_data.company_name !== after_data.company_name) {
        const new_company_name = after_data.company_name;

        const batch = admin.firestore().batch();

        const user_ref = admin.firestore().collection("users");
        const user_snapshot = await user_ref
          .where("role_name", "==", "Manager")
          .where("company_id", "==", before_data.company_id)
          .limit(1)
          .get();

        if (!user_snapshot.empty) {
          const doc = user_snapshot.docs[0];
          batch.update(doc.ref, { company_name: new_company_name });
        }

        await batch.commit();
      }
    } catch (error) {
      console.error("Error updating company_name : ", error);
    }
  });

exports.checkUpdatedDocument = functions.firestore
  .document("{collectionId}/{docId}")
  .onUpdate(async (change, context) => {
    const collection_id = context.params.collectionId;
    const doc_id = context.params.docId;

    try {
      console.log(collection_id);
      console.log(doc_id);

      if (collection_id.startsWith("overtime_employees - ")) {
        const company_id = collection_id.split("overtime_employees - ")[1];

        const before_data = change.before.data();
        const after_data = change.after.data();

        if (
          before_data.is_checked_overtime !== after_data.is_checked_overtime
        ) {
          await db
            .collection(`attendances - ${company_id}`)
            .doc(doc_id)
            .update({
              is_checked_overtime: after_data.is_checked_overtime,
              overtime: after_data.overtime,
            });

          await db.collection(collection_id).doc(doc_id).delete();
        }
      } else if (collection_id.startsWith("leave - ")) {
        const company_id = collection_id.split("leave - ")[1];

        const before_data = change.before.data();
        const after_data = change.after.data();

        const chat_id = after_data.chat_id;
        const employee_id = after_data.employee_id;
        const type = after_data.type;

        if (type == "izin sakit") {
          if (after_data.foto_bukti == null) {
            const now = DateTime.now().setZone("Asia/Jakarta");
            const time = now.toFormat("HH:mm");

            // const now = new Date();
            // const time = after_data.time;
            // const [hours, minutes] = time.split(":").map(Number);

            // const time_date = new Date(
            //   now.getFullYear(),
            //   now.getMonth(),
            //   now.getDate(),
            //   hours,
            //   minutes
            // );

            // const time_reminder = new Date(time_date);
            // time_reminder.setHours(time_reminder.getHours() + 8);

            await db.collection("sick_note_reminder").doc(employee_id).set({
              chat_id: chat_id,
              company_id: company_id,
              document_id: doc_id,
              time: time,
              is_sent: false,
            });
          } else {
            await db.collection("sick_note_reminder").doc(employee_id).delete();

            const token_snapshot = await db
              .collection("tokens")
              .where("document_id", "==", doc_id)
              .limit(1)
              .get();

            if (!token_snapshot.empty) {
              const token_doc_ref = token_snapshot.docs[0].ref;
              await token_doc_ref.delete();
            }
          }
        }

        let date_array, status;
        if (before_data.is_approved !== after_data.is_approved) {
          date_array = after_data.date;

          if (after_data.is_approved == true) {
            const name = after_data.employee_name;
            const division = after_data.division;

            console.log(date_array);

            date_array.forEach(async (date) => {
              console.log(date);
              const [year, month, day] = date.split("-");
              const date_object = new Date(`${year}-${month}-${day}`);

              const day_name = date_object.toLocaleString("id-ID", {
                weekday: "long",
              });
              const month_name = date_object.toLocaleString("id-ID", {
                month: "long",
              });

              await db
                .collection(`attendances - ${company_id}`)
                .doc(`${chat_id} - ${year}${month}${day}`)
                .set({
                  arrival_time: null,
                  departure_time: null,
                  employee_arrival_location: null,
                  employee_departure_location: null,
                  photo_url_arrival: null,
                  photo_url_departure: null,
                  is_verified_arrival: null,
                  is_verified_departure: null,
                  expected_hours: null,
                  is_checked_overtime: null,
                  late_time: null,
                  overtime: null,
                  shift_name: null,
                  work_hours: null,
                  clock_in: null,
                  clock_out: null,
                  date: date,
                  day: day_name,
                  month: month_name,
                  year: year,
                  employee_id: employee_id,
                  company_id: company_id,
                  name: name,
                  division: division,
                  status: type,
                });
            });

            if (type.toLowerCase() == "cuti") {
              const employee_collection = db
                .collection("employees")
                .doc(employee_id);

              const employee_snapshot = await employee_collection.get();

              if (employee_snapshot.exists) {
                const employee_data = employee_snapshot.data();

                const remained_leave = employee_data.remained_leave;
                const total = after_data.total;

                if (remained_leave >= total) {
                  await employee_collection.update({
                    remained_leave: remained_leave - total,
                  });
                }
              }
            }

            status = "telah disetujui";
          } else {
            status = "ditolak";
          }

          console.log(date_array);

          const change_date_format = (date_array) => {
            return date_array
              .map((date) => {
                const [year, month, day] = date.split("-");
                return `${day}-${month}-${year}`;
              })
              .join(", ");
          };

          const new_date_array = change_date_format(date_array);

          const telegram_api_url = `https://api.telegram.org/bot${
            functions.config().telegrambot.key
          }/sendMessage`;

          const telegram_response = await axios.post(telegram_api_url, {
            chat_id: chat_id,
            text: `Pengajuan ${type}mu untuk tanggal ${new_date_array} ${status} oleh admin.`,
          });

          console.log("Message sent : ", telegram_response.data);

          await db.collection(collection_id).doc(doc_id).delete();
        }
      } else if (collection_id.startsWith("attendances - ")) {
        const company_id = collection_id.split("attendances - ")[1];

        const before_data = change.before.data();
        const after_data = change.after.data();

        if (
          before_data.is_verified_out_status !==
            after_data.is_verified_out_status &&
          after_data.is_verified_out_status == true
        ) {
          const chat_id = after_data.chat_id;
          const employee_id = after_data.employee_id;
          const division = after_data.division;
          const work_hours = after_data.work_hours;
          const expected_hours = after_data.expected_hours;

          const employee_snapshot = await db
            .collection("employees")
            .doc(employee_id)
            .get();
          const employee_data = employee_snapshot.data();
          const expected_salary = employee_data.gaji_pokok;

          console.log(company_id);
          console.log(division);
          console.log(work_hours);

          const division_snapshot = await db
            .collection("divisions")
            .where("company_id", "==", company_id)
            .where("name_division", "==", division)
            .limit(1)
            .get();

          if (!division_snapshot.empty) {
            const division_data = division_snapshot.docs[0].data();
            const work_hours_per_week = division_data.jam_kerja_mingguan;
            const expected_work_hours = work_hours_per_week * 4;

            const salary_per_hour = expected_salary / expected_work_hours;

            const now = DateTime.now().setZone("Asia/Jakarta");
            const month = now.setLocale("id").toFormat("MMMM");
            const year = now.year;

            // const attendance_snapshot = await db.collection(`attendances - ${company_id}`).doc(doc_id).get();
            // const attendance_data = attendance_snapshot.data();

            let total_minutes_worked;

            const hours_match = work_hours.match(/(\d+)\s*jam/);
            const minutes_match = work_hours.match(/(\d+)\s*menit/);

            const hours = hours_match ? parseInt(hours_match[1]) : 0;
            const minutes = minutes_match ? parseInt(minutes_match[1]) : 0;

            console.log(hours);
            console.log(minutes);

            if (hours >= expected_hours) {
              total_minutes_worked = hours * 60;
            } else {
              total_minutes_worked = hours * 60 + minutes;
            }

            console.log(total_minutes_worked);

            const total_hours_worked = Math.ceil(total_minutes_worked / 60);
            console.log(total_hours_worked);

            let salary = Math.ceil(total_hours_worked * salary_per_hour);

            if (salary >= expected_salary) {
              salary = expected_salary;
            }

            console.log(salary);

            const salary_snapshot = await db
              .collection(`salaries - ${company_id}`)
              .where("employee_id", "==", employee_id)
              .where("month", "==", month)
              .where("year", "==", year)
              .limit(1)
              .get();

            if (!salary_snapshot.empty) {
              const salary_doc = salary_snapshot.docs[0];
              const salary_data = salary_doc.data();
              const current_salary = salary_data.salary;

              salary += current_salary;

              await salary_doc.ref.update({
                salary: salary,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(
        `Error deleting ${collection_id} with document id ${doc_id}: `,
        error
      );
    }
  });

exports.test_chat = functions.https.onRequest(async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");

  console.log(`Request Method : ${request.method}`);

  // handle preflight method
  if (request.method === "OPTIONS") {
    response.status(204).send("");
  } else if (request.method === "POST") {
    const phone_number = request.body.phone_number;

    // console.log(phone_number);

    if (!phone_number) {
      return response.status(400).send("phone_number is required");
    }

    try {
      const employee_collection = admin.firestore().collection("employees");
      const employee_snapshot = await employee_collection
        .where("telepon", "==", phone_number)
        .limit(1)
        .get();

      if (employee_snapshot.empty) {
        return response.status(404).send("Employee Not Found");
      }

      const employee_doc = employee_snapshot.docs[0];
      const employee_data = employee_doc.data();
      const chat_id = employee_data.chat_id;

      if (!chat_id) {
        return response.status(404).send("Chat ID Not Found");
      }

      const telegram_api_url = `https://api.telegram.org/bot${
        functions.config().telegrambot.key
      }/sendMessage`;

      const telegram_response = await axios.post(telegram_api_url, {
        chat_id: chat_id,
        text: "Halo! 👋🏻\n\n[Ini pesan dari admin untuk memverifikasi nomor telepon]",
      });

      await employee_doc.ref.update({
        is_verified_phone_number: true,
      });

      console.log("Message sent : ", telegram_response.data);
      return response.status(200).send("Pesan berhasil dikirim");
    } catch (error) {
      console.error("Sending message error : ", error);
      return response.status(500).send("Gagal mengirim pesan");
    }
  } else {
    return response.status(405).send("Method Not Allowed");
  }
});

let user_otp_code = {};

/**
 * Function for requesting OTP code from new user.
 * @param {FirebaseFirestore.CollectionReference} collection Firebase Firestore Collection Reference.
 * @param {string} chat_id Telegram User Chat ID.
 **/
async function requestOTP(collection, chat_id) {
  bot.on(message("text"), async (ctx) => {
    // try {
    const otp_code = ctx.message.text;
    user_otp_code[chat_id] = otp_code;
    console.log(user_otp_code[chat_id]);

    const employee_snapshot = await collection
      .where("kode_otp", "==", otp_code)
      .limit(1)
      .get();

    if (employee_snapshot.empty) {
      ctx.reply(
        "Profil tidak ditemukan dengan kode OTP tersebut. Silakan coba lagi."
      );

      await requestOTP(collection, chat_id);
    }

    const employee_data = employee_snapshot.docs[0].data();
    const name = employee_data.name;
    const gender = employee_data.jenis_kelamin;
    const nik = employee_data.nik;
    const phone_number = employee_data.telepon;
    const email = employee_data.email;
    const birthdate = employee_data.tgl_lahir;
    const birthplace = employee_data.tmp_lahir;
    const marital_status = employee_data.status_kawin;
    const company_name = employee_data.company_name;
    const title = employee_data.jabatan;
    const division = employee_data.divisi;
    const employment_type = employee_data.status;
    const religion = employee_data.agama;
    const address = employee_data.alamat_tinggal;
    const id_address = employee_data.alamat;

    ctx.reply(
      `Berikut ini profil Anda :\n
      Nama: ${name}\n
      Jenis Kelamin: ${gender}\n
      NIK: ${nik}\n
      Nomor Telepon: ${phone_number}\n
      Email: ${email}\n
      Tanggal Lahir: ${birthdate}\n
      Tempat Lahir: ${birthplace}\n
      Status Perkawinan: ${marital_status}\n
      Nama Perusahaan: ${company_name}\n
      Jabatan: ${title}\n
      Divisi: ${division}\n
      Status Kepegawaian: ${employment_type}\n
      Agama: ${religion}\n
      Alamat : ${address}\n
      Alamat (sesuai KTP): ${id_address}\n\n
      Apakah data tersebut benar profil Anda?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Ya", callback_data: "yes-profile" }],
            [{ text: "Tidak", callback_data: "no-profile" }],
          ],
        },
      }
    );
    // } catch (error) {
    //   console.error("Error requesting OTP Code : ", error);
    //   ctx.reply(
    //     "Terjadi kesalahan saat menerima kode OTP. Cobalah beberapa saat lagi."
    //   );
    // }
  });
}

/**
 * Function to load photo links from JSON file in Firebase Storage.
 **/
async function loadPhotoLinks() {
  try {
    const file = bucket.file("photo_url.json");

    const [data] = await file.download();
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading photo links : ", error);
    return [];
  }
}

/**
 * Function for uploading photo to Firebase Storage.
 * @param {string} photo_url Photo URL from Telegram.
 * @param {string} file_name File Name.
 * @param {string} chat_id Telegram User Chat ID.
 **/
async function uploadPhoto(photo_url, file_name, chat_id) {
  try {
    const company_id = await user_company_id[chat_id];
    if (company_id) {
      const response = await fetch(photo_url);
      const buffer = Buffer.from(await response.arrayBuffer());

      // const company_id = company_id;
      const file_path = `${company_id}/${chat_id}/${file_name}`;
      const file = bucket.file(file_path);
      await file.save(buffer);

      return await getDownloadURL(file);
    } else {
      return "Company ID not found";
    }
  } catch (error) {
    console.error("Error uploading photo : ", error);
    return;
  }
}

/**
 * Function to save used photo link to JSON file in Firebase Storage.
 * @param {string[]} links Photo URL.
 **/
async function savePhotoLinks(links) {
  try {
    const file = bucket.file("photo_url.json");
    await file.save(JSON.stringify(links, null, 2), {
      contentType: "application/json",
    });

    console.log("Photo links saved successfully");
  } catch (error) {
    console.error("Error saving photo links : ", error);
    return;
  }
}

/**
 * Function to detect whether there is a face or not in the image given.
 * @param {string} photo_url Photo URL from Firebase Storage.
 **/
async function faceDetection(photo_url) {
  try {
    const request = {
      image: {
        source: { imageUri: photo_url },
      },
    };

    // Detect face using ML Kit
    const [result] = await clientVision.faceDetection(request);
    const faces = result.faceAnnotations;

    if (faces && faces.length > 0) {
      console.log("Wajah terdeteksi!");
      return "Wajah terdeteksi!";
    } else {
      console.log("Tidak ada wajah terdeteksi");
      return "Tidak ada wajah terdeteksi";
    }
  } catch (error) {
    console.error("Error detecting face : ", error);
    return;
  }
}

/**
 * Function to get attendance history.
 * @param {string} month Selected Month.
 * @param {string} ctx Narrowed Context Telegram.
 **/
async function attendanceHistory(month, ctx) {
  const chat_id = ctx.from.id;

  try {
    const company_id = await user_company_id[chat_id];
    const employee_id = await user_employee_id[chat_id];

    const attendance_collection = db.collection(`attendances - ${company_id}`);
    const attendance_snapshot = await attendance_collection
      .where("employee_id", "==", employee_id)
      .where("month", "==", month)
      .where("is_verified_arrival", "==", true)
      // .where("is_verified_departure", "==", true)
      .get();

    if (attendance_snapshot.empty) {
      return "Belum ada data riwayat absensi.";
    }

    const attendance_data = [];

    attendance_snapshot.forEach((doc) => {
      const data = doc.data();

      const arrival_time = data.arrival_time
        ? data.arrival_time.toDate()
        : null;

      const departure_time = data.departure_time
        ? data.departure_time.toDate()
        : null;

      const zoned_arrival = arrival_time
        ? DateTime.fromJSDate(arrival_time, { zone: "Asia/Jakarta" })
        : null;
      const zoned_departure = departure_time
        ? DateTime.fromJSDate(departure_time, { zone: "Asia/Jakarta" })
        : null;

      const formatted_arrival = zoned_arrival
        ? zoned_arrival.toFormat("HH:mm:ss")
        : "-";
      const formatted_departure = zoned_departure
        ? zoned_departure.toFormat("HH:mm:ss")
        : "-";

      attendance_data.push({
        date: data.date || "-",
        day: data.day || "-",
        arrival_time: formatted_arrival,
        departure_time: formatted_departure,
        late_time: data.late_time || "-",
        work_hours: data.work_hours || "-",
        status: data.status || "-",
      });
    });

    let message = `Berikut ini riwayat absensi Anda :\n\n`;

    attendance_data.forEach((attendance, index) => {
      message += `#${index + 1}\n`;
      message += `Tanggal: ${attendance.date}\n`;
      message += `Hari: ${attendance.day}\n`;
      message += `Absen Masuk: ${attendance.arrival_time}\n`;
      message += `Absen Keluar: ${attendance.departure_time}\n`;
      message += `Waktu Keterlambatan: ${attendance.late_time}\n`;
      message += `Total Jam Kerja: ${attendance.work_hours}\n`;
      message += `Status: ${attendance.status}\n\n`;
    });

    return message;
  } catch (error) {
    console.log("Error collecting user attendance history : ", error);
    return "Terjadi kesalahan saat mengambil data riwayat absensi. Cobalah beberapa saat lagi.";
  }
}

/**
 * Function to save excel file to Firebase Storage.
 * @param {string} file_name Excel File Name.
 * @param {string} buffer Buffer from Excel File.
 **/
async function saveFileToFirebaseStorage(file_name, buffer) {
  try {
    const bucket = getStorage().bucket();
    const file = bucket.file(file_name);
    await file.save(buffer);
    return file.name;
  } catch (error) {
    console.log("Error saving file to Firestore : ", error);
    return;
  }
}

/**
 * Function to get excel file from Firebase Storage.
 * @param {string} file_name Excel File Name.
 **/
async function downloadFileFromFirebaseStorage(file_name) {
  try {
    const bucket = getStorage().bucket();
    const tempFilePath = path.join(os.tmpdir(), file_name);
    await bucket.file(file_name).download({ destination: tempFilePath });
    return tempFilePath;
  } catch (error) {
    console.log("Error getting file from Firestore : ", error);
    return;
  }
}

/**
 * Function to convert excel to PDF file.
 * @param {string} excel_file_path Excel File Path.
 * @param {string} pdf_file_path PDF File Path.
 **/
async function convertExcelToPDF(excel_file_path, pdf_file_path) {
  try {
    const workbook = new excelJS.Workbook();
    await workbook.xlsx.readFile(excel_file_path);
    const worksheet = workbook.getWorksheet(1);

    const doc = new PDFDocument({ size: "A4", layout: "landscape" });
    doc.pipe(fs.createWriteStream(pdf_file_path));

    const column_widths = [90, 90, 80, 85, 90, 100, 100];
    const column_headers = [
      "Tanggal",
      "Hari",
      "Absen Masuk",
      "Absen Keluar",
      "Waktu Keterlambatan",
      "Total Jam Kerja",
      "Status",
    ];

    // Draw header
    let x = 50; // Starting x position
    let y = 50; // Starting y position
    doc.fontSize(12).font("Helvetica-Bold");

    // Draw header row
    column_headers.forEach((header, index) => {
      doc.text(header, x + index * column_widths[index], y);
    });

    // Draw header line
    doc
      .moveTo(50, y + 15)
      .lineTo(50 + column_widths.reduce((a, b) => a + b, 0) + 60, y + 15)
      .stroke();

    doc.font("Helvetica");
    y += 20; // Move down for the data rows

    // Draw each row of data
    worksheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return;

      x = 50; // Reset x position for each row
      row.eachCell((cell, colNumber) => {
        doc.text(
          cell.value,
          x + (colNumber - 1) * column_widths[colNumber - 1],
          y
        );
      });
      y += 15; // Move down for the next row

      // Draw line after each row
      doc
        .moveTo(50, y - 5)
        .lineTo(50 + column_widths.reduce((a, b) => a + b, 0) + 60, y - 5)
        .stroke();
    });

    doc.end();
  } catch (error) {
    console.log("Error converting excel file to pdf file : ", error);
    return;
  }
}

/**
 * Function to delete excel file from Firebase Storage.
 * @param {string} file_name Excel File Name.
 **/
async function deleteFileFromFirebaseStorage(file_name) {
  try {
    const bucket = getStorage().bucket();
    await bucket.file(file_name).delete();
  } catch (error) {
    console.log("Error deleting file to Firestore : ", error);
    return;
  }
}

async function getDocumentId(now, chat_id, collection_name) {
  const yesterday = now.minus({ days: 1 }).toFormat("yyyyMMdd");
  const document_id = `${chat_id} - ${yesterday}`;

  console.log(document_id);

  user_attendance_collection[chat_id] = { collection_name, document_id };

  const attendance_collection = db.collection(collection_name).doc(document_id);

  // const attendance_snapshot = await attendance_collection.get();

  // if (!attendance_snapshot.exists) {
  //   ctx.reply(
  //     "Anda belum melakukan absen masuk hari ini.\n\nAbsensi masuk dapat dilakukan menggunakan command /masuk"
  //   );

  //   return;
  // }

  return document_id;
}

async function getDateLeave(company_id, employee_id) {
  const attendance_snapshot = await db
    .collection(`attendances - ${company_id}`)
    .where("employee_id", "==", employee_id)
    .where("status", "in", ["izin", "izin sakit", "cuti"])
    .get();

  const dates = new Set();

  attendance_snapshot.forEach((doc) => {
    const data = doc.data();
    const date = data.date;
    dates.add(date);

    console.log(data);
    console.log(date);
  });

  console.log(Array.from(dates));

  return Array.from(dates);
}

async function outAttendance(
  collection_name,
  document_id,
  overtime,
  is_checked_overtime,
  departure_time,
  work_hours,
  status
) {
  console.log(collection_name);
  console.log(document_id);
  console.log(overtime);
  console.log(is_checked_overtime);
  console.log(departure_time);
  console.log(work_hours);
  console.log(status);

  const attendance_collection = db.collection(collection_name).doc(document_id);

  await attendance_collection.update({
    departure_time: departure_time,
    work_hours: work_hours,
    is_verified_departure: false,
    status: status,
    overtime: overtime,
    is_checked_overtime: is_checked_overtime,
  });

  return;

  // const time = new Date().valueOf();
  // user_timestamp[chat_id] = time;
  // user_attendance_type[chat_id] = "Absen keluar";

  // ctx.reply("Silakan bagikan lokasi Anda saat ini.", {
  //   reply_markup: {
  //     keyboard: [
  //       [
  //         {
  //           text: "Bagikan Lokasi 📍",
  //           request_location: true, // asking for location
  //         },
  //       ],
  //     ],
  //     resize_keyboard: true,
  //     one_time_keyboard: true,
  //   },
  // });
}

exports.setupReminders = functions.pubsub
  .schedule("0 3 * * *") // run everyday at 03:00
  .timeZone("Asia/Jakarta")
  .onRun(async (context) => {
    const now = DateTime.now().setZone("Asia/Jakarta");

    const employee_snapshot = await db
      .collection("employees")
      .where("chat_id", "!=", null)
      // .where("chat_id", "==", 5142972565)
      // .limit(1)
      .get();

    for (const doc of employee_snapshot.docs) {
      const employee_data = doc.data();
      const employee_id = doc.id;
      const company_id = employee_data.company_id;
      const chat_id = employee_data.chat_id;

      const schedule_shift_snapshot = await db
        .collection("schedule_shift")
        .where("employee_id", "==", employee_id)
        .limit(1)
        .get();

      if (schedule_shift_snapshot.empty) {
        console.log(
          `Schedule shift for employee_id ${employee_id} is not found`
        );
        continue;
      }

      const schedule_shift_doc = schedule_shift_snapshot.docs[0].data();
      const shift = schedule_shift_doc[now.toFormat("dd-MM-yyyy")];

      if (!shift) {
        console.log(
          `Shift for date ${now.toFormat(
            "dd-MM-yyyy"
          )} with employee_id ${employee_id} is not found`
        );

        continue;
      }

      let clock_in = shift.jam_masuk;
      let clock_out = shift.jam_pulang;

      if (clock_in != null && clock_out != null) {
        const reminder_collection = db
          .collection("reminders")
          .doc(`${employee_id}`);

        await reminder_collection.set(
          {
            chat_id: chat_id,
            clock_in: clock_in,
            clock_out: clock_out,
            company_id: company_id,
            in_is_sent: false,
            out_is_sent: false,
          },
          { merge: true }
        );
      }
    }

    console.log("Reminders have been set up!");
  });

exports.runReminder = functions.pubsub
  .schedule("*/1 * * * *") // run every 1 minute
  .timeZone("Asia/Jakarta")
  .onRun(async (context) => {
    const now = new Date();

    now.setHours(now.getHours() + 7);

    const reminder_snapshot = await db.collection("reminders").get();

    for (const doc of reminder_snapshot.docs) {
      const reminder_data = doc.data();
      const chat_id = reminder_data.chat_id;
      const clock_in = reminder_data.clock_in;
      const clock_out = reminder_data.clock_out;
      const in_is_sent = reminder_data.in_is_sent;
      const out_is_sent = reminder_data.out_is_sent;

      console.log(chat_id);
      console.log(clock_in);
      console.log(clock_out);

      if (clock_in && !in_is_sent) {
        const [hours, minutes] = clock_in.split(":").map(Number);

        const clock_in_date = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          hours,
          minutes
        );

        const clock_in_reminder = new Date(clock_in_date);
        clock_in_reminder.setMinutes(clock_in_reminder.getMinutes() - 10);

        // console.log(new Date(now));
        // console.log(new Date(clock_in_reminder));
        // console.log(new Date(clock_in_date));

        if (
          now.getHours() === clock_in_reminder.getHours() &&
          now.getMinutes() === clock_in_reminder.getMinutes()
        ) {
          await bot.telegram.sendMessage(
            chat_id,
            "Halo, jam masukmu kurang 10 menit nih, jangan lupa absen, ya! ⏰\n\nAbaikan pesan ini jika kamu sudah melakukan absen masuk 😉"
          );

          console.log("Clock in reminder sent.");

          await doc.ref.update({
            in_is_sent: true,
          });
        }
      }

      if (clock_out && !out_is_sent) {
        const [hours, minutes] = clock_out.split(":").map(Number);

        const clock_out_date = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          hours,
          minutes
        );

        // const clock_out_reminder =
        //   new Date(clock_out_date).getTime() + 10 * 60 * 1000;

        const clock_out_reminder = new Date(clock_out_date);
        clock_out_reminder.setMinutes(clock_out_reminder.getMinutes() + 10);

        // console.log(new Date(now));
        // console.log(clock_out_reminder);
        // console.log(new Date(clock_out_date));

        if (
          now.getHours() === clock_out_reminder.getHours() &&
          now.getMinutes() === clock_out_reminder.getMinutes()
        ) {
          await bot.telegram.sendMessage(
            chat_id,
            "Hai, jam kerjamu sudah lewat, yuk absen keluar dulu! 🏠\n\nAbaikan pesan ini jika kamu sudah melakukan absen keluar 😉"
          );

          console.log("Clock out reminder sent.");

          await doc.ref.update({
            out_is_sent: true,
          });
        }
      }
    }
  });

exports.runReminderSickNote = functions.pubsub
  .schedule("*/1 * * * *") // run every 1 minute
  .timeZone("Asia/Jakarta")
  .onRun(async (context) => {
    const now = new Date();

    now.setHours(now.getHours() + 7);

    const reminder_snapshot = await db.collection("sick_note_reminder").get();

    for (const doc of reminder_snapshot.docs) {
      const reminder_data = doc.data();
      const chat_id = reminder_data.chat_id;
      const company_id = reminder_data.company_id;
      const document_id = reminder_data.document_id;
      const time = reminder_data.time;
      const is_sent = reminder_data.is_sent;

      console.log(chat_id);
      console.log(time);
      console.log(is_sent);

      if (!is_sent) {
        const [hours, minutes] = time.split(":").map(Number);

        const time_date = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          hours,
          minutes
        );

        const time_reminder = new Date(time_date);
        time_reminder.setHours(time_reminder.getHours() + 8);
        // time_reminder.setMinutes(time_reminder.getMinutes() + 1);

        console.log(new Date(now));
        console.log(new Date(time_date));
        console.log(new Date(time_reminder));

        if (
          now.getHours() === time_reminder.getHours() &&
          now.getMinutes() === time_reminder.getMinutes()
        ) {
          const url =
            "https://attendiq-180f1.web.app/#/form/upload-surat-dokter";
          const token = crypto.randomBytes(32).toString("hex");
          const expiration = Date.now() + 10 * 60 * 1000;

          await db.collection("tokens").doc(token).set({
            document_id: document_id,
            company_id: company_id,
            expiration: expiration,
          });

          await bot.telegram.sendMessage(
            chat_id,
            `⚠️ Anda belum upload foto surat dokter atau surat lain sebagai bukti dukung bahwa Anda sakit.\n\nSegera upload bukti dukung tersebut melalui link di bawah ini (kedaluwarsa dalam 10 menit) supaya pengajuan izin sakit Anda dapat segera diproses oleh admin :\n${url}?token=${token}&company_id=${company_id}&id=${document_id}`
          );

          console.log("Sick note reminder sent.");

          // await doc.ref.update({
          //   is_sent: true,
          // });

          await doc.ref.delete();
        }
      }
    }
  });

bot.telegram.setMyCommands([
  // { command: "start", description: "Memulai bot" },
  { command: "help", description: "Bantuan cara menggunakan bot" },
  {
    command: "riwayat_absen",
    description: "Menampilkan daftar riwayat absensi",
  },
  { command: "masuk", description: "Absen masuk melalui bot" },
  { command: "keluar", description: "Absen keluar melalui bot" },
  { command: "pengajuan_cuti", description: "Pengajuan cuti" },
  { command: "pengajuan_izin", description: "Pengajuan izin" },
  { command: "pengajuan_izin_sakit", description: "Pengajuan izin sakit" },
  {
    command: "upload_surat_dokter",
    description: "Upload bukti dukung izin sakit",
  },
  // { command: "verif_masuk", description: "Verifikasi absen masuk" },
  // { command: "verif_keluar", description: "Verifikasi absen keluar" },
]);

bot.command("help", (ctx) => {
  ctx.reply(
    "Mulai bot dengan command /start.\nJika Anda adalah pengguna baru, bot akan meminta kode OTP untuk keperluan pengecekkan profil."
  );
});

bot.start(async (ctx) => {
  try {
    const chat_id = ctx.from.id;

    const employee_collection = db.collection("employees");
    const employee_snapshot = await employee_collection
      .where("chat_id", "==", chat_id)
      .get();

    if (employee_snapshot.empty) {
      ctx.reply("Silakan kirim kode OTP Anda.");

      await requestOTP(employee_collection, chat_id);

      return;
    }

    ctx.reply("Hello! 👋");
  } catch (error) {
    console.error("Error accessing Firestore : ", error);
    ctx.reply("Server mengalami gangguan. Cobalah beberapa saat lagi.");
  }
});

let user_timestamp = {};
let user_attendance_collection = {};

bot.command("masuk", async (ctx) => {
  try {
    const now = DateTime.now().setZone("Asia/Jakarta");

    const arrival_time = now.toJSDate();
    const date = now.setLocale("id").toFormat("yyyy-MM-dd");
    const month = now.setLocale("id").toFormat("MMMM");
    const year = now.year;

    const chat_id = ctx.from.id;

    const employee_collection = db.collection("employees");
    const employee_snapshot = await employee_collection
      .where("chat_id", "==", chat_id)
      .limit(1)
      .get();

    if (employee_snapshot.empty) {
      ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");

      await requestOTP(employee_collection, chat_id);

      return;
    }

    const employee_doc = employee_snapshot.docs[0].data();
    const employee_id = employee_snapshot.docs[0].id;
    const name = employee_doc.name;
    const company_id = employee_doc.company_id;
    const division = employee_doc.divisi;

    const today = now.toFormat("yyyyMMdd");
    console.log(today);

    const collection_name = `attendances - ${company_id}`;
    const document_id = `${chat_id} - ${today}`;
    // const document_id = `${chat_id} - ${20241115}`;

    console.log(collection_name);
    console.log(document_id);

    user_attendance_collection[chat_id] = { collection_name, document_id };

    const time = new Date().valueOf();
    user_timestamp[chat_id] = time;
    user_attendance_type[chat_id] = "Absen masuk";

    const attendance_collection = db
      .collection(collection_name)
      .doc(document_id);

    const attendance_snapshot = await attendance_collection.get();

    if (attendance_snapshot.exists) {
      const attendance_doc = attendance_snapshot.data();

      if ("is_verified_arrival" in attendance_doc) {
        const is_verified_arrival = attendance_doc.is_verified_arrival;

        if (is_verified_arrival == true) {
          ctx.reply("Anda sudah melakukan absensi masuk");
          return;
        } else if (is_verified_arrival == false) {
          ctx.reply("Silakan bagikan lokasi Anda saat ini.", {
            reply_markup: {
              keyboard: [
                [
                  {
                    text: "Bagikan Lokasi 📍",
                    request_location: true, // asking for location
                  },
                ],
              ],
              resize_keyboard: true,
              one_time_keyboard: true,
            },
          });

          return;
        }
      }
    }

    const division_snapshot = await db
      .collection("divisions")
      .where("name_division", "==", division)
      .where("company_id", "==", company_id)
      .limit(1)
      .get();

    if (division_snapshot.empty) {
      ctx.reply("Divisi tidak ditemukan");
      return;
    }

    const division_data = division_snapshot.docs[0].data();
    const minute_tolerance = division_data.toleransi_absen_masuk;
    // console.log(minute_tolerance);

    const schedule_shift_collection = db.collection("schedule_shift");
    const schedule_shift_snapshot = await schedule_shift_collection
      .where("employee_id", "==", employee_id)
      .limit(1)
      .get();

    if (schedule_shift_snapshot.empty) {
      ctx.reply("Jadwal shift tidak ditemukan");
      return;
    }

    const schedule_shift_data = schedule_shift_snapshot.docs[0].data();
    const shift = schedule_shift_data[now.toFormat("dd-MM-yyyy")];

    if (!shift) {
      ctx.reply("Shift tidak ditemukan.");
      return;
    }

    const day = shift.hari;
    const clock_in = shift.jam_masuk;
    let clock_out = shift.jam_pulang;
    const shift_name = shift.shift;
    const expected_hours = shift.jumlah_jam;

    let status = null;
    let late_time = null;

    if (clock_in != null) {
      const [hours, minutes] = clock_in.split(":").map(Number);

      let clock_in_convert = now.set({
        hour: hours,
        minute: minutes,
        second: 0,
      });

      // console.log(clock_in_convert);

      clock_in_convert = clock_in_convert.plus({ minutes: minute_tolerance });
      // console.log(clock_in_convert);

      if (arrival_time > clock_in_convert) {
        status = "Terlambat";
        late_time = (arrival_time - clock_in_convert) / 60000;

        const hours = Math.floor(late_time / 60);
        const minutes = Math.floor(late_time % 60);

        late_time = `${hours} jam ${minutes} menit`;
      } else {
        status = "Tepat Waktu";
        late_time = "0 jam";
      }
    } else {
      let expected_departure_time = now.plus({ hours: expected_hours });
      clock_out = expected_departure_time.toFormat("HH:mm");

      expected_departure_time = expected_departure_time.toFormat("HH:mm");
      // console.log(expected_departure_time);

      const reminder_collection = db
        .collection("reminders")
        .doc(`${employee_id}`);

      await reminder_collection.set(
        {
          chat_id: chat_id,
          clock_in: null,
          clock_out: expected_departure_time,
          company_id: company_id,
          in_is_sent: false,
          out_is_sent: false,
        },
        { merge: true }
      );
    }

    let clock_out_time = DateTime.fromFormat(clock_out, "HH:mm");

    const reminder_1 = clock_out_time.plus({ minutes: 25 }).toFormat("HH:mm");
    const reminder_2 = clock_out_time.plus({ minutes: 40 }).toFormat("HH:mm");
    const reminder_3 = clock_out_time.plus({ minutes: 55 }).toFormat("HH:mm");
    const reminder_4 = clock_out_time.plus({ minutes: 70 }).toFormat("HH:mm");

    const attendance_data = {
      employee_id: employee_id,
      name: name,
      company_id: company_id,
      division: division,
      shift_name: shift_name,
      expected_hours: expected_hours,
      day: day,
      month: month,
      year: year,
      clock_in: clock_in,
      clock_out: clock_out,
      date: date,
      arrival_time: arrival_time,
      status: status,
      late_time: late_time,
      is_verified_arrival: false,
      clock_out_reminder_1: reminder_1,
      clock_out_reminder_2: reminder_2,
      clock_out_reminder_3: reminder_3,
      clock_out_reminder_4: reminder_4,
      sent_count: 0,
    };

    await attendance_collection.set(attendance_data);

    ctx.reply("Silakan bagikan lokasi Anda saat ini.", {
      reply_markup: {
        keyboard: [
          [
            {
              text: "Bagikan Lokasi 📍",
              request_location: true, // asking for location
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } catch (error) {
    console.error("Error recording arrival attendance : ", error);
    ctx.reply("Gagal mencatat absen masuk, silakan coba lagi.");
  }
});

let out_attendance_confirmation_message_id = {};

bot.command("keluar", async (ctx) => {
  try {
    const now = DateTime.now().setZone("Asia/Jakarta");

    const departure_time = now.toJSDate();
    const today = now.toFormat("yyyyMMdd");

    const chat_id = ctx.from.id;

    const employee_collection = db.collection("employees");
    const employee_snapshot = await employee_collection
      .where("chat_id", "==", chat_id)
      .limit(1)
      .get();

    if (employee_snapshot.empty) {
      ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");

      await requestOTP(employee_collection, chat_id);

      return;
    }

    const employee_doc = employee_snapshot.docs[0].data();
    const company_id = employee_doc.company_id;
    const division = employee_doc.divisi;

    const collection_name = `attendances - ${company_id}`;
    let document_id = `${chat_id} - ${today}`;

    console.log(collection_name);
    console.log(document_id);

    user_attendance_collection[chat_id] = { collection_name, document_id };

    let attendance_collection = db.collection(collection_name).doc(document_id);

    let attendance_snapshot = await attendance_collection.get();

    if (!attendance_snapshot.exists) {
      document_id = await getDocumentId(now, chat_id, collection_name);

      attendance_collection = db.collection(collection_name).doc(document_id);
      attendance_snapshot = await attendance_collection.get();

      // const yesterday = now.minus({ days: 1 }).toFormat("yyyyMMdd");
      // document_id = `${chat_id} - ${yesterday}`;

      // console.log(document_id);

      // user_attendance_collection[chat_id] = { collection_name, document_id };

      // attendance_collection = db.collection(collection_name).doc(document_id);

      // attendance_snapshot = await getAttendanceSnapshot();

      if (!attendance_snapshot.exists) {
        ctx.reply(
          "Anda belum melakukan absen masuk hari ini.\n\nAbsensi masuk dapat dilakukan menggunakan command /masuk"
        );

        return;
      }
    }

    const attendance_data = attendance_snapshot.data();

    if (attendance_data.is_verified_arrival == false) {
      document_id = await getDocumentId(now, chat_id, collection_name);

      attendance_collection = db.collection(collection_name).doc(document_id);
      attendance_snapshot = await attendance_collection.get();

      // const yesterday = now.minus({ days: 1 }).toFormat("yyyyMMdd");
      // document_id = `${chat_id} - ${yesterday}`;

      // console.log(document_id);

      // user_attendance_collection[chat_id] = { collection_name, document_id };

      // attendance_collection = db.collection(collection_name).doc(document_id);

      // attendance_snapshot = await getAttendanceSnapshot();

      if (!attendance_snapshot.exists) {
        ctx.reply(
          "Anda belum melakukan absen masuk hari ini.\n\nAbsensi masuk dapat dilakukan menggunakan command /masuk"
        );

        return;
      }
    }

    if ("out_status" in attendance_data) {
      ctx.reply(
        "❌ Tidak dapat melakukan absen keluar. Batas waktu sudah habis."
      );

      return;
    }

    if ("is_verified_departure" in attendance_data) {
      const is_verified_departure = attendance_data.is_verified_departure;

      if (is_verified_departure == true) {
        ctx.reply("Anda sudah melakukan absensi keluar");
        return;
      } else if (is_verified_departure == false) {
        ctx.reply("Silakan bagikan lokasi Anda saat ini.", {
          reply_markup: {
            keyboard: [
              [
                {
                  text: "Bagikan Lokasi 📍",
                  request_location: true, // asking for location
                },
              ],
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        });

        return;
      }
    }

    const arrival_time = new Date(attendance_data.arrival_time._seconds * 1000);
    // const clock_out = attendance_data.clock_out;

    const arrival_time_convert =
      DateTime.fromJSDate(arrival_time).setZone("Asia/Jakarta");

    const diff = now
      .diff(arrival_time_convert, ["hours", "minutes"])
      .toObject();

    const hours = Math.floor(diff.hours);
    const minutes = Math.floor(diff.minutes);

    const work_hours = `${hours} jam ${minutes} menit`;

    const expected_hours = attendance_data.expected_hours;

    let overtime = false;
    let is_checked_overtime = null;

    const division_snapshot = await db
      .collection("divisions")
      .where("name_division", "==", division)
      .where("company_id", "==", company_id)
      .limit(1)
      .get();

    if (division_snapshot.empty) {
      console.log(
        `Division ${division} from company id '${company_id}' not found.`
      );

      ctx.reply("Divisi tidak ditemukan.");

      return;
    }

    const division_data = division_snapshot.docs[0].data();
    const minute_tolerance = division_data.toleransi_absen_pulang;

    const overtime_threshold = expected_hours * 60 + minute_tolerance;
    const work_minutes = hours * 60 + minutes;

    console.log(work_minutes);
    console.log(overtime_threshold);

    if (work_minutes > overtime_threshold) {
      const user_snapshot = await db
        .collection("users")
        .where("role_id", "==", 90)
        .where("company_id", "==", company_id)
        .limit(1)
        .get();

      const user_data = user_snapshot.docs[0].data();
      const overtime_validation = user_data.verifikasi_lembur;

      if (overtime_validation.toLowerCase() == "manual") {
        is_checked_overtime = false;
      } else if (overtime_validation.toLowerCase() == "otomatis") {
        overtime = true;
      }
    }

    let status = attendance_data.status;
    if (status == null) {
      if (hours < expected_hours) {
        status = `Kurang dari ${expected_hours} Jam`;

        const { message_id } = await ctx.reply(
          `⚠️ Total jam kerja Anda kurang dari ${expected_hours} jam. Apakah Anda ingin untuk melanjutkan proses absen keluar?`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Ya", callback_data: "yes-out" }],
                [{ text: "Tidak", callback_data: "no-out" }],
              ],
            },
          }
        );

        out_attendance_confirmation_message_id[chat_id] = message_id;

        user_attendance_collection[chat_id] = {
          collection_name,
          document_id,
          overtime,
          is_checked_overtime,
          departure_time,
          work_hours,
          status,
        };

        return;
      } else {
        status = "Sesuai Total Jam Kerja";
      }
    }

    await outAttendance(
      collection_name,
      document_id,
      overtime,
      is_checked_overtime,
      departure_time,
      work_hours,
      status
    );

    // await attendance_collection.update({
    //   departure_time: departure_time,
    //   work_hours: work_hours,
    //   is_verified_departure: false,
    //   status: status,
    //   overtime: overtime,
    //   is_checked_overtime: is_checked_overtime,
    // });

    const time = new Date().valueOf();
    user_timestamp[chat_id] = time;
    user_attendance_type[chat_id] = "Absen keluar";

    ctx.reply("Silakan bagikan lokasi Anda saat ini.", {
      reply_markup: {
        keyboard: [
          [
            {
              text: "Bagikan Lokasi 📍",
              request_location: true, // asking for location
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } catch (error) {
    console.error("Error recording departure attendance : ", error);
    ctx.reply("Gagal mencatat absen keluar, silakan coba lagi.");
  }
});

bot.command("verif_masuk", async (ctx) => {
  const chat_id = ctx.from.id;

  try {
    const employee_collection = db.collection("employees");
    const employee_snapshot = await employee_collection
      .where("chat_id", "==", chat_id)
      .limit(1)
      .get();

    if (employee_snapshot.empty) {
      ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");

      await requestOTP(employee_collection, chat_id);

      return;
    }

    const employee_doc = employee_snapshot.docs[0].data();
    const company_id = employee_doc.company_id;

    const now = DateTime.now().setZone("Asia/Jakarta");
    const today = now.toFormat("yyyyMMdd");

    const collection_name = `attendances - ${company_id}`;
    const document_id = `${chat_id} - ${today}`;

    const attendance_collection = db
      .collection(collection_name)
      .doc(document_id);

    const attendance_snapshot = await attendance_collection.get();

    if (!attendance_snapshot.exists) {
      ctx.reply(
        "Anda belum melakukan absen masuk hari ini.\n\nAbsensi masuk dapat dilakukan menggunakan command /masuk"
      );

      return;
    }

    const attendance_doc = attendance_snapshot.data();
    const is_verified_arrival = attendance_doc.is_verified_arrival;

    if (is_verified_arrival == true) {
      ctx.reply("Anda sudah melakukan absensi masuk");
      return;
    }

    ctx.reply("Silakan bagikan lokasi Anda saat ini.", {
      reply_markup: {
        keyboard: [
          [
            {
              text: "Bagikan Lokasi 📍",
              request_location: true, // asking for location
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } catch (error) {
    console.error("Error validating arrival attendance : ", error);
    ctx.reply("Gagal verifikasi absen masuk, silakan coba lagi.");
  }
});

bot.command("verif_keluar", async (ctx) => {
  const chat_id = ctx.from.id;

  try {
    const employee_collection = db.collection("employees");
    const employee_snapshot = await employee_collection
      .where("chat_id", "==", chat_id)
      .limit(1)
      .get();

    if (employee_snapshot.empty) {
      ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");

      await requestOTP(employee_collection, chat_id);

      return;
    }

    const employee_doc = employee_snapshot.docs[0].data();
    const company_id = employee_doc.company_id;

    const now = DateTime.now().setZone("Asia/Jakarta");
    const today = now.toFormat("yyyyMMdd");

    const collection_name = `attendances - ${company_id}`;
    const document_id = `${chat_id} - ${today}`;

    const attendance_collection = db
      .collection(collection_name)
      .doc(document_id);

    const attendance_snapshot = await attendance_collection.get();

    if (!attendance_snapshot.exists) {
      ctx.reply(
        "Anda belum melakukan absen masuk hari ini.\n\nAbsensi masuk dapat dilakukan menggunakan command /masuk"
      );

      return;
    }

    const attendance_doc = attendance_snapshot.data();

    if ("is_verified_departure" in attendance_doc) {
      const is_verified_departure = attendance_doc.is_verified_departure;

      if (is_verified_departure == true) {
        ctx.reply("Anda sudah melakukan absensi keluar");
        return;
      }
    }

    ctx.reply("Silakan bagikan lokasi Anda saat ini.", {
      reply_markup: {
        keyboard: [
          [
            {
              text: "Bagikan Lokasi 📍",
              request_location: true, // asking for location
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } catch (error) {
    console.error("Error validating departure attendance : ", error);
    ctx.reply("Gagal verifikasi absen keluar. Cobalah beberapa saat lagi.");
  }
});

let user_employee_id = {};
let user_company_id = {};
let user_selected_month = {};
let attendance_history_message_id = {};

bot.command("riwayat_absen", async (ctx) => {
  const chat_id = ctx.from.id;

  try {
    const employee_collection = db.collection("employees");
    const employee_snapshot = await employee_collection
      .where("chat_id", "==", chat_id)
      .limit(1)
      .get();

    if (employee_snapshot.empty) {
      ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");

      await requestOTP(employee_collection, chat_id);

      return;
    }

    const employee_doc = employee_snapshot.docs[0].data();
    const employee_id = employee_snapshot.docs[0].id;
    const company_id = employee_doc.company_id;

    user_employee_id[chat_id] = employee_id;
    user_company_id[chat_id] = company_id;

    const { message_id } = await ctx.reply(
      "Silakan pilih periode riwayat absensi yang ingin Anda lihat.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Bulan Ini", callback_data: "current-month" }],
            [{ text: "Bulan Lalu", callback_data: "past-month" }],
          ],
        },
      }
    );

    attendance_history_message_id[chat_id] = message_id;
  } catch (error) {
    console.log("Error collecting user attendance history : ", error);

    ctx.reply(
      "Terjadi kesalahan saat mengambil data riwayat absensi. Cobalah beberapa saat lagi."
    );
  }
});

const url_message = new Map();

bot.command("pengajuan_izin", async (ctx) => {
  const chat_id = ctx.from.id;

  const employee_collection = await db
    .collection("employees")
    .where("chat_id", "==", chat_id)
    .limit(1)
    .get();

  if (employee_collection.empty) {
    ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");
    await requestOTP(employee_collection, chat_id);
    return;
  }

  const employee_data = employee_collection.docs[0].data();
  const company_id = employee_data.company_id;

  const leave_snapshot = await db
    .collection(`leave - ${company_id}`)
    .where("chat_id", "==", chat_id)
    .where("type", "in", ["izin", "cuti"])
    .where("is_approved", "==", null)
    .limit(1)
    .get();

  if (!leave_snapshot.empty) {
    const leave_data = leave_snapshot.docs[0].data();
    // const token = leave_data.token;

    if (leave_data.hasOwnProperty("date")) {
      ctx.reply(
        "Pengajuan izin atau cuti Anda sebelumnya masih dalam proses persetujuan oleh admin."
      );

      return;
    } else {
      leave_snapshot.docs[0].ref.delete();

      // await db.collection("tokens").doc(token).delete();
      // await ctx.deleteMessage(url_message.get("izin/cuti"));
    }
  }

  const { message_id } = await ctx.reply(
    "⏳ Mohon tunggu sebentar, proses pembuatan link ..."
  );

  url_message.set("message_id", message_id);

  const employee_id = employee_collection.docs[0].id;
  const employee_name = employee_data.name;
  const company_name = employee_data.company_name;
  const division = employee_data.divisi;
  const position = employee_data.jabatan;

  const user_snapshot = await db
    .collection("users")
    .where("company_id", "==", company_id)
    .where("role_id", "==", 90)
    .limit(1)
    .get();

  const user_data = user_snapshot.docs[0].data();
  const min_leave_day = user_data.min_pengajuan_izin;
  const max_leave_day = user_data.max_pengajuan_izin;

  const date_leave = await getDateLeave(company_id, employee_id);

  const url = "https://attendiq-180f1.web.app/#/form/izin";
  const token = crypto.randomBytes(32).toString("hex");
  const expiration = Date.now() + 10 * 60 * 1000;

  await db.collection("tokens").doc(token).set({
    employee_id: employee_id,
    expiration: expiration,
  });

  const document = await db.collection(`leave - ${company_id}`).add({
    chat_id: chat_id,
    type: "izin",
    employee_id: employee_id,
    employee_name: employee_name,
    company_id: company_id,
    company_name: company_name,
    division: division,
    position: position,
    min_leave_day: min_leave_day,
    max_leave_day: max_leave_day,
    date_leave: date_leave,
    is_approved: null,
  });

  const document_id = document.id;
  // }

  // ctx.reply(`${url}?token=${token}&company_id=${company_id}&id=${document_id}`);

  await ctx.deleteMessage(url_message.get("message_id"));

  bot.telegram
    .sendMessage(
      chat_id,
      `Silakan isi formulir berikut (kedaluwarsa dalam 10 menit) :\n${url}?token=${token}&company_id=${company_id}&id=${document_id}`
    )
    .then((sentMessage) => {
      setTimeout(() => {
        bot.telegram
          .deleteMessage(chat_id, sentMessage.message_id)
          .catch((error) => {
            console.error("Error deleting message : ", error);
          });
      }, 600000); // 600000 ms = 10 minutes

      url_message.set("izin/cuti", sentMessage.message_id);
    });
});

bot.command("pengajuan_cuti", async (ctx) => {
  const chat_id = ctx.from.id;

  const employee_snapshot = await db
    .collection("employees")
    .where("chat_id", "==", chat_id)
    .limit(1)
    .get();

  if (employee_snapshot.empty) {
    ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");
    await requestOTP(employee_snapshot, chat_id);
    return;
  }

  const employee_data = employee_snapshot.docs[0].data();
  const company_id = employee_data.company_id;

  const leave_snapshot = await db
    .collection(`leave - ${company_id}`)
    .where("chat_id", "==", chat_id)
    .where("type", "in", ["izin", "cuti"])
    .where("is_approved", "==", null)
    .limit(1)
    .get();

  if (!leave_snapshot.empty) {
    const leave_data = leave_snapshot.docs[0].data();
    // const token = leave_data.token;

    if (leave_data.hasOwnProperty("date")) {
      ctx.reply(
        "Pengajuan izin atau cuti Anda sebelumnya masih dalam proses persetujuan oleh admin."
      );

      return;
    } else {
      leave_snapshot.docs[0].ref.delete();

      // await db.collection("tokens").doc(token).delete();
      // await ctx.deleteMessage(url_message.get("izin/cuti"));
    }
  }

  const { message_id } = await ctx.reply(
    "⏳ Mohon tunggu sebentar, proses pembuatan link ..."
  );

  url_message.set("message_id", message_id);

  const employee_id = employee_snapshot.docs[0].id;
  const employee_name = employee_data.name;
  const company_name = employee_data.company_name;
  const division = employee_data.divisi;
  const position = employee_data.jabatan;

  let leave_quota_monthly, leave_quota_annual, min_leave_day, remained_leave;
  if (
    employee_data.hasOwnProperty("leave_quota_monthly") ||
    employee_data.hasOwnProperty("leave_quota_annual")
  ) {
    leave_quota_monthly = employee_data.leave_quota_monthly; // cuti nonrapel
    leave_quota_annual = employee_data.leave_quota_annual; // cuti rapel
    min_leave_day = employee_data.min_leave_day;
    remained_leave = employee_data.remained_leave;
  } else {
    const user_snapshot = await db
      .collection("users")
      .where("company_id", "==", company_id)
      .where("role_id", "==", 90)
      .limit(1)
      .get();

    const user_data = user_snapshot.docs[0].data();
    const min_month = user_data.min_ambil_cuti;

    let join_date = employee_data.tanggal_diterima;

    const [day, month, year] = join_date.split("-");
    join_date = new Date(`${year}-${month}-${day}`);
    join_date.setMonth(join_date.getMonth() + min_month);

    const current_date = DateTime.now().setZone("Asia/Jakarta").toJSDate();

    console.log(join_date);
    console.log(current_date);

    if (join_date > current_date) {
      ctx.reply("Anda belum dapat mengambil cuti");
      return;
    }

    leave_quota_monthly = user_data.jatah_bulanan; // cuti nonrapel
    leave_quota_annual = user_data.jatah_setahun; // cuti rapel
    min_leave_day = user_data.min_pengajuan_cuti;

    if (leave_quota_monthly != null) {
      remained_leave = leave_quota_monthly;
    } else if (leave_quota_annual != null) {
      remained_leave = leave_quota_annual;
    }

    await db.collection("employees").doc(employee_id).update({
      leave_quota_monthly: leave_quota_monthly,
      leave_quota_annual: leave_quota_annual,
      min_leave_day: min_leave_day,
      remained_leave: remained_leave,
    });
  }

  if (remained_leave <= 0) {
    ctx.reply("Jatah cuti Anda sudah habis");
    return;
  }

  const date_leave = await getDateLeave(company_id, employee_id);

  console.log(leave_quota_monthly);
  console.log(leave_quota_annual);
  console.log(min_leave_day);
  console.log(remained_leave);

  const url = "https://attendiq-180f1.web.app/#/form/izin-cuti";
  const token = crypto.randomBytes(32).toString("hex");
  const expiration = Date.now() + 10 * 60 * 1000;

  await db.collection("tokens").doc(token).set({
    employee_id: employee_id,
    expiration: expiration,
  });

  const document = await db.collection(`leave - ${company_id}`).add({
    chat_id: chat_id,
    type: "cuti",
    employee_id: employee_id,
    employee_name: employee_name,
    company_id: company_id,
    company_name: company_name,
    division: division,
    position: position,
    leave_quota_monthly: leave_quota_monthly,
    leave_quota_annual: leave_quota_annual,
    min_leave_day: min_leave_day,
    remained_leave: remained_leave,
    date_leave: date_leave,
    is_approved: null,
  });

  const document_id = document.id;

  // ctx.reply(`${url}?token=${token}&company_id=${company_id}&id=${document_id}`);

  await ctx.deleteMessage(url_message.get("message_id"));

  bot.telegram
    .sendMessage(
      chat_id,
      `Silakan isi formulir berikut (kedaluwarsa dalam 10 menit) :\n${url}?token=${token}&company_id=${company_id}&id=${document_id}`
    )
    .then((sentMessage) => {
      setTimeout(() => {
        bot.telegram
          .deleteMessage(chat_id, sentMessage.message_id)
          .catch((error) => {
            console.error("Error deleting message : ", error);
          });
      }, 600000); // 600000 ms = 10 minutes

      url_message.set("izin/cuti", sentMessage.message_id);
    });
});

bot.command("pengajuan_izin_sakit", async (ctx) => {
  const chat_id = ctx.from.id;

  const employee_snapshot = await db
    .collection("employees")
    .where("chat_id", "==", chat_id)
    .limit(1)
    .get();

  if (employee_snapshot.empty) {
    ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");
    await requestOTP(employee_snapshot, chat_id);
    return;
  }

  const employee_data = employee_snapshot.docs[0].data();
  const company_id = employee_data.company_id;

  const leave_snapshot = await db
    .collection(`leave - ${company_id}`)
    .where("type", "==", "izin sakit")
    .where("chat_id", "==", chat_id)
    // .where("foto_bukti", "!=", null)
    .where("is_approved", "==", null)
    .limit(1)
    .get();

  if (!leave_snapshot.empty) {
    const leave_data = leave_snapshot.docs[0].data();

    if (leave_data.hasOwnProperty("date")) {
      if (leave_data.foto_bukti == null) {
        ctx.reply(
          "⚠️ File bukti dukung izin sakit Anda saat ini masih kosong. Segera upload foto tersebut melalui command /upload_surat_dokter"
        );

        return;
      }

      ctx.reply(
        "Pengajuan izin sakit Anda sebelumnya masih dalam proses persetujuan oleh admin."
      );

      return;
    } else {
      leave_snapshot.docs[0].ref.delete();

      // await ctx.deleteMessage(url_message.get("sakit"));
    }
  }

  const { message_id } = await ctx.reply(
    "⏳ Mohon tunggu sebentar, proses pembuatan link ..."
  );

  url_message.set("message_id", message_id);

  const employee_id = employee_snapshot.docs[0].id;
  const employee_name = employee_data.name;
  const company_name = employee_data.company_name;
  const division = employee_data.divisi;
  const position = employee_data.jabatan;

  const date_leave = await getDateLeave(company_id, employee_id);

  const url = "https://attendiq-180f1.web.app/#/form/izin-sakit";
  const token = crypto.randomBytes(32).toString("hex");
  const expiration = Date.now() + 10 * 60 * 1000;

  await db.collection("tokens").doc(token).set({
    employee_id: employee_id,
    expiration: expiration,
  });

  const document = await db.collection(`leave - ${company_id}`).add({
    chat_id: chat_id,
    type: "izin sakit",
    employee_id: employee_id,
    employee_name: employee_name,
    company_id: company_id,
    company_name: company_name,
    division: division,
    position: position,
    date_leave: date_leave,
    is_approved: null,
  });

  const document_id = document.id;
  // }

  // ctx.reply(`${url}?token=${token}&company_id=${company_id}&id=${document_id}`);

  await ctx.deleteMessage(url_message.get("message_id"));

  bot.telegram
    .sendMessage(
      chat_id,
      `Silakan isi formulir berikut (kedaluwarsa dalam 10 menit) :\n${url}?token=${token}&company_id=${company_id}&id=${document_id}`
    )
    .then((sentMessage) => {
      setTimeout(() => {
        bot.telegram
          .deleteMessage(chat_id, sentMessage.message_id)
          .catch((error) => {
            console.error("Error deleting message : ", error);
          });
      }, 600000); // 600000 ms = 10 minutes
    });

  url_message.set("sakit", sentMessage.message_id);
});

bot.command("upload_surat_dokter", async (ctx) => {
  const chat_id = ctx.from.id;

  const employee_snapshot = await db
    .collection("employees")
    .where("chat_id", "==", chat_id)
    .limit(1)
    .get();

  if (employee_snapshot.empty) {
    ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");
    await requestOTP(employee_snapshot, chat_id);
    return;
  }

  const employee_data = employee_snapshot.docs[0].data();
  const employee_id = employee_snapshot.docs[0].id;
  const company_id = employee_data.company_id;

  const leave_snapshot = await db
    .collection(`leave - ${company_id}`)
    .where("chat_id", "==", chat_id)
    .where("type", "==", "izin sakit")
    .where("foto_bukti", "==", null)
    .limit(1)
    .get();

  if (leave_snapshot.empty) {
    ctx.reply(
      "❌ Anda tidak memiliki pengajuan izin sakit yang bukti dukungnya belum diunggah.\n\n⚠️ Jika Anda merasa belum mengunggah bukti dukung atas pengajuan izin sakit Anda, silakan mengisi ulang formulir melalui command /pengajuan_izin_sakit"
    );

    return;
  }

  const document_id = leave_snapshot.docs[0].id;

  const url = "https://attendiq-180f1.web.app/#/form/upload-surat-dokter";
  const token = crypto.randomBytes(32).toString("hex");
  const expiration = Date.now() + 10 * 60 * 1000;

  await db.collection("tokens").doc(token).set({
    employee_id: employee_id,
    expiration: expiration,
  });

  ctx.reply(
    `Silakan upload bukti dukung izin sakit Anda melalui link di bawah ini (kedaluwarsa dalam 10 menit) :\n${url}?token=${token}&company_id=${company_id}&id=${document_id}`
  );
});

bot.on("callback_query", async (ctx) => {
  const callback_data = ctx.callbackQuery.data;

  const now = DateTime.now().setZone("Asia/Jakarta");
  const month = now.setLocale("id").toFormat("MMMM");

  if (callback_data === "current-month") {
    try {
      const chat_id = ctx.from.id;
      ctx.deleteMessage(await attendance_history_message_id[chat_id]);

      const { message_id } = await ctx.reply(
        "⏳ Mohon tunggu sebentar, proses pengambilan data ... "
      );

      const message = await attendanceHistory(month, ctx);

      ctx.deleteMessage(message_id);

      await ctx.reply(message);

      if (message != "Belum ada data riwayat absensi.") {
        user_selected_month[chat_id] = month;

        const { message_id } = await ctx.reply(
          "Apakah Anda ingin mengonversi riwayat absensi Anda menjadi file?",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Ya", callback_data: "yes-file" }],
                [{ text: "Tidak", callback_data: "no-file" }],
              ],
            },
          }
        );

        attendance_history_message_id[chat_id] = message_id;
      }
    } catch (error) {
      console.log(
        "Error collecting user attendance history (current month) : ",
        error
      );

      ctx.reply(
        "Terjadi kesalahan saat mengambil data riwayat absensi bulan ini. Cobalah beberapa saat lagi."
      );
    }
  } else if (callback_data === "past-month") {
    try {
      const chat_id = ctx.from.id;
      ctx.deleteMessage(await attendance_history_message_id[chat_id]);

      const company_id = await user_company_id[chat_id];
      const employee_id = await user_employee_id[chat_id];

      const attendance_collection = db.collection(
        `attendances - ${company_id}`
      );

      const attendance_snapshot = await attendance_collection
        .where("employee_id", "==", employee_id)
        .where("is_verified_arrival", "==", true)
        .where("is_verified_departure", "==", true)
        .get();

      const months = new Set();

      attendance_snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.month != month) {
          months.add(data.month);
        }
      });

      const months_list = Array.from(months);

      if (months_list.length === 0) {
        ctx.reply("Belum ada data riwayat absensi bulan lalu.");

        return;
      }

      const inline_keyboard = months_list.map((month) => [
        { text: month, callback_data: `month_${month}` },
      ]);

      const { message_id } = await ctx.reply(
        "Silakan pilih bulan di bawah ini.",
        {
          reply_markup: {
            inline_keyboard: inline_keyboard,
          },
        }
      );

      attendance_history_message_id[chat_id] = message_id;
    } catch (error) {
      console.log("Error getting month list from attendance history : ", error);
      ctx.reply("Terjadi kesalahan. Cobalah beberapa saat lagi.");
    }
  } else if (callback_data === "yes-location") {
    const { message_id } = await ctx.reply(
      "⏳ Mohon tunggu sebentar, proses pengecekan lokasi ... "
    );

    try {
      const chat_id = ctx.from.id;
      ctx.deleteMessage(await asking_location_message_id[chat_id]);

      const employee_collection = db.collection("employees");
      const employee_snapshot = await employee_collection
        .where("chat_id", "==", chat_id)
        .limit(1)
        .get();

      if (employee_snapshot.empty) {
        ctx.deleteMessage(message_id);
        ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");

        await requestOTP(employee_collection, chat_id);

        return;
      }

      const employee_doc = employee_snapshot.docs[0].data();
      const company_id = employee_doc.company_id;
      user_company_id[chat_id] = company_id;

      const user_collection = db.collection("users");
      const user_snapshot = await user_collection
        .where("role_name", "==", "Manager")
        .where("company_id", "==", company_id)
        .limit(1)
        .get();

      if (user_snapshot.empty) {
        ctx.deleteMessage(message_id);
        ctx.reply("Lokasi kantor tidak ditemukan.");
        return;
      }

      const user_doc = user_snapshot.docs[0].data();
      const company_location = user_doc.company_location;

      const company_position = {
        latitude: company_location._latitude,
        longitude: company_location._longitude,
      };

      // Define the radius in meters
      const radius = 1000; // 1 kilometer

      const location = await user_location[chat_id];

      if (!location) {
        ctx.deleteMessage(message_id);
        ctx.reply(
          "Lokasi tidak ditemukan. Silakan bagikan ulang lokasi Anda saat ini."
        );

        return;
      }

      const { latitude, longitude } = location;
      const employee_position = { latitude, longitude };

      const distance = geolib.getDistance(company_position, employee_position);
      const is_within_radius = distance <= radius;

      if (is_within_radius) {
        const collection_name = await user_attendance_collection[chat_id]
          .collection_name;

        const document_id = await user_attendance_collection[chat_id]
          .document_id;

        const attendance_collection = db
          .collection(collection_name)
          .doc(document_id);

        // console.log(attendance_collection);

        const attendance_type = await user_attendance_type[chat_id];

        const employee_location = new GeoPoint(latitude, longitude);

        if (attendance_type == "Absen masuk") {
          await attendance_collection.update({
            employee_arrival_location: employee_location,
          });
        } else if (attendance_type == "Absen keluar") {
          await attendance_collection.update({
            employee_departure_location: employee_location,
          });
        } else {
          ctx.deleteMessage(message_id);
          ctx.reply("Tidak ditemukan data lokasi.");
          return;
        }

        ctx.deleteMessage(message_id);
        ctx.reply(
          "✅ Lokasi dalam radius 1 kilometer dari kantor.\n\n📷 Silakan kirim foto Anda."
        );
      } else {
        ctx.deleteMessage(message_id);
        ctx.reply(
          "❌ Lokasi di luar radius 1 kilometer dari kantor.\n\nAnda harus berada dalam radius 1 kilometer dari lokasi kantor Anda."
        );

        return;
      }
    } catch (error) {
      console.log("Error checking location : ", error);

      ctx.deleteMessage(message_id);

      ctx.reply(
        "Terjadi kesalahan saat pengecekkan lokasi. Cobalah beberapa saat lagi."
      );
    }
  } else if (callback_data === "no-location") {
    ctx.deleteMessage(asking_location_message_id[ctx.from.id]);
    ctx.reply("Silakan bagikan ulang lokasi Anda saat ini.", {
      reply_markup: {
        keyboard: [
          [
            {
              text: "Bagikan Lokasi 📍",
              request_location: true, // asking for location
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } else if (callback_data === "yes-profile") {
    try {
      const chat_id = ctx.from.id;

      const otp_code = await user_otp_code[chat_id];

      const employee_collection = db.collection("employees");
      const employee_snapshot = await employee_collection
        .where("kode_otp", "==", otp_code)
        .limit(1)
        .get();

      const employee_doc = employee_snapshot.docs[0];
      await employee_collection.doc(employee_doc.id).update({
        chat_id: chat_id,
        kode_otp: admin.firestore.FieldValue.delete(),
      });

      ctx.reply("Profil berhasil disimpan.");
    } catch (error) {
      console.log("Error validating new user profile : ", error);

      ctx.reply(
        "Terjadi kesalahan saat menerima kode OTP. Cobalah beberapa saat lagi."
      );
    }
  } else if (callback_data === "no-profile") {
    try {
      const chat_id = ctx.from.id;

      ctx.reply("Silakan kirim ulang kode OTP Anda.");

      const employee_collection = db.collection("employees");

      requestOTP(employee_collection, chat_id);
    } catch (error) {
      console.log("Error requesting OTP Code : ", error);

      ctx.reply(
        "Terjadi kesalahan saat meminta kode OTP. Cobalah beberapa saat lagi."
      );
    }
  } else if (callback_data.startsWith("month_")) {
    try {
      const chat_id = ctx.from.id;
      ctx.deleteMessage(await attendance_history_message_id[chat_id]);

      const selected_month = callback_data.split("_")[1];

      const message = await attendanceHistory(selected_month, ctx);

      ctx.reply(message);

      if (message != "Belum ada data riwayat absensi.") {
        user_selected_month[chat_id] = selected_month;

        const { message_id } = await ctx.reply(
          "Apakah Anda ingin mengonversi riwayat absensi Anda menjadi file?",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Ya", callback_data: "yes-file" }],
                [{ text: "Tidak", callback_data: "no-file" }],
              ],
            },
          }
        );

        attendance_history_message_id[chat_id] = message_id;
      }
    } catch (error) {
      console.log(
        "Error collecting user attendance history (past month) : ",
        error
      );

      ctx.reply(
        "Terjadi kesalahan saat mengambil data riwayat absensi bulan lalu. Cobalah beberapa saat lagi."
      );
    }
  } else if (callback_data === "yes-file") {
    try {
      const chat_id = ctx.from.id;
      ctx.deleteMessage(await attendance_history_message_id[chat_id]);

      const { message_id } = await ctx.reply(
        "⏳ Mohon tunggu sebentar, proses pembuatan file ..."
      );

      attendance_history_message_id[chat_id] = message_id;

      const company_id = await user_company_id[chat_id];
      const employee_id = await user_employee_id[chat_id];
      const month = await user_selected_month[chat_id];

      const attendance_collection = db.collection(
        `attendances - ${company_id}`
      );
      const attendance_snapshot = await attendance_collection
        .where("employee_id", "==", employee_id)
        .where("month", "==", month)
        .where("is_verified_arrival", "==", true)
        .where("is_verified_departure", "==", true)
        .get();

      if (attendance_snapshot.empty) {
        return "Belum ada data riwayat absensi.";
      }

      const workbook = new excelJS.Workbook();
      const worksheet = workbook.addWorksheet("Riwayat Absensi");

      worksheet.columns = [
        { header: "Tanggal", key: "date", width: 15 },
        { header: "Hari", key: "day", width: 15 },
        { header: "Absen Masuk", key: "arrival_time", width: 20 },
        { header: "Absen Keluar", key: "departure_time", width: 20 },
        { header: "Waktu Keterlambatan", key: "late_time", width: 25 },
        { header: "Total Jam Kerja", key: "work_hours", width: 25 },
        { header: "Status", key: "status", width: 15 },
      ];

      worksheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true };
      });

      const attendance_data = [];

      attendance_snapshot.forEach((doc) => {
        const data = doc.data();

        const arrival_time = data.arrival_time;
        const departure_time = data.departure_time;

        const arrival_date = arrival_time.toDate();
        const departure_date = departure_time.toDate();

        const zoned_arrival = DateTime.fromJSDate(arrival_date, {
          zone: "Asia/Jakarta",
        });

        const zoned_departure = DateTime.fromJSDate(departure_date, {
          zone: "Asia/Jakarta",
        });

        const formatted_arrival = zoned_arrival.toFormat("HH:mm:ss");
        const formatted_departure = zoned_departure.toFormat("HH:mm:ss");

        attendance_data.push({
          date: data.date,
          day: data.day,
          arrival_time: formatted_arrival,
          departure_time: formatted_departure,
          late_time: data.late_time,
          work_hours: data.work_hours,
          status: data.status,
        });
      });

      attendance_data.forEach((row) => {
        worksheet.addRow(row);
      });

      // save file
      const excel_buffer = await workbook.xlsx.writeBuffer();
      const excel_file_name = `Riwayat_Absensi_${month}.xlsx`;
      await saveFileToFirebaseStorage(excel_file_name, excel_buffer);

      const excel_file_path = await downloadFileFromFirebaseStorage(
        excel_file_name
      );

      const pdf_file_path = "/tmp/riwayat_absensi.pdf";

      console.log(excel_file_path);

      await convertExcelToPDF(excel_file_path, pdf_file_path);

      ctx.deleteMessage(await attendance_history_message_id[chat_id]);

      ctx.sendMediaGroup([
        {
          type: "document",
          media: {
            source: fs.createReadStream(excel_file_path),
            filename: `Riwayat Absensi (${month}).xlsx`,
          },
        },
        {
          type: "document",
          media: {
            source: fs.createReadStream(pdf_file_path),
            filename: `Riwayat Absensi (${month}).pdf`,
          },
        },
      ]);

      await deleteFileFromFirebaseStorage(excel_file_name);

      fs.unlinkSync(excel_file_path);
    } catch (error) {
      console.log("Error generating attendance history file : ", error);

      ctx.reply(
        "Terjadi kesalahan saat mengonversi file. Cobalah beberapa saat lagi."
      );
    }
  } else if (callback_data === "no-file") {
    ctx.deleteMessage(attendance_history_message_id[ctx.from.id]);
  } else if (callback_data === "yes-out") {
    const chat_id = ctx.from.id;
    ctx.deleteMessage(await out_attendance_confirmation_message_id[chat_id]);

    const collection_name = await user_attendance_collection[chat_id]
      .collection_name;
    const document_id = await user_attendance_collection[chat_id].document_id;
    const overtime = await user_attendance_collection[chat_id].overtime;
    const is_checked_overtime = await user_attendance_collection[chat_id]
      .is_checked_overtime;
    const departure_time = await user_attendance_collection[chat_id]
      .departure_time;
    const work_hours = await user_attendance_collection[chat_id].work_hours;
    const status = await user_attendance_collection[chat_id].status;

    await outAttendance(
      collection_name,
      document_id,
      overtime,
      is_checked_overtime,
      departure_time,
      work_hours,
      status
    );

    const time = new Date().valueOf();
    user_timestamp[chat_id] = time;
    user_attendance_type[chat_id] = "Absen keluar";

    ctx.reply("Silakan bagikan lokasi Anda saat ini.", {
      reply_markup: {
        keyboard: [
          [
            {
              text: "Bagikan Lokasi 📍",
              request_location: true, // asking for location
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } else if (callback_data === "no-out") {
    const chat_id = ctx.from.id;
    ctx.deleteMessage(await out_attendance_confirmation_message_id[chat_id]);

    ctx.reply(
      "🔔 Reminder absen keluar akan dikirim saat total jam kerja Anda sudah terpenuhi."
    );
  }
});

bot.hears("hi", (ctx) => ctx.reply("hi there 👋"));

bot.on(message("photo"), async (ctx) => {
  const chat_id = ctx.from.id;

  const { message_id } = await ctx.reply(
    "⏳ Mohon tunggu sebentar, proses verifikasi foto ..."
  );

  try {
    let timestamp;
    if (await user_timestamp[chat_id]) {
      timestamp = await user_timestamp[chat_id];
    } else {
      const employee_collection = db.collection("employees");
      const employee_snapshot = await employee_collection
        .where("chat_id", "==", chat_id)
        .limit(1)
        .get();

      if (employee_snapshot.empty) {
        ctx.deleteMessage(message_id);
        ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.");
        ctx.react();

        await requestOTP(employee_collection, chat_id);

        return;
      }

      // const employee_doc = employee_snapshot.docs[0].data();
      // const company_id = employee_doc.company_id;

      // const now = DateTime.now().setZone("Asia/Jakarta");
      // const today = now.toFormat("yyyyMMdd");

      // const attendance_doc_ref = db
      //   .collection(`attendances - ${company_id}`)
      //   .doc(`${chat_id} - ${today}`);

      const collection_name = await user_attendance_collection[chat_id]
        .collection_name;

      const document_id = await user_attendance_collection[chat_id].document_id;

      const attendance_collection = db
        .collection(collection_name)
        .doc(document_id);

      // console.log(attendance_collection);

      const attendance_snapshot = await attendance_collection.get();

      if (!attendance_snapshot.exists) {
        ctx.deleteMessage(message_id);
        ctx.reply("Anda belum melakukan absensi hari ini.");
        ctx.react();

        return;
      }

      const attendance_data = attendance_snapshot.data();
      const arrival_time = attendance_data.arrival_time;
      timestamp = arrival_time.toMillis();
    }

    // const time_limit = timestamp + 30 * 1000;
    // const time_limit = timestamp + 10 * 60 * 1000;
    // const current_time = new Date().valueOf();

    // if (current_time > time_limit) {
    //   ctx.deleteMessage(message_id);
    //   ctx.reply(
    //     "Waktu verifikasi absen telah habis. Silakan mengulangi proses absen."
    //   );
    //   ctx.react();

    //   return;
    // }

    const image_id = ctx.message.photo.pop().file_id;
    ctx.telegram.getFileLink(image_id).then(async (link) => {
      const photoLinks = await loadPhotoLinks();

      if (photoLinks.includes(link.href)) {
        ctx.deleteMessage(message_id);
        ctx.reply(
          "Foto yang Anda kirim sudah pernah digunakan sebelumnya. Mohon untuk mengirim foto terbaru Anda."
        );
        ctx.react("👎");
      } else {
        // ctx.reply(link);
        const time = Timestamp.now().valueOf();

        await uploadPhoto(link.href, time + ".jpeg", chat_id).then(
          async (publicUrl) => {
            // ctx.reply(publicUrl);

            ctx.deleteMessage;

            await faceDetection(publicUrl).then(async (res) => {
              let reminder_type;
              if (res == "Tidak ada wajah terdeteksi") {
                ctx.deleteMessage(message_id);
                ctx.reply(`${res}. Mohon untuk mengirim ulang foto Anda.`);
                ctx.react("👎");
              } else if (res == "Wajah terdeteksi!") {
                photoLinks.push(link);
                await savePhotoLinks(photoLinks);

                // const now = DateTime.now().setZone("Asia/Jakarta");
                // const today = now.toFormat("yyyyMMdd");

                const attendance_type = await user_attendance_type[chat_id];

                const collection_name = await user_attendance_collection[
                  chat_id
                ].collection_name;

                const document_id = await user_attendance_collection[chat_id]
                  .document_id;

                const attendance_collection = db
                  .collection(collection_name)
                  .doc(document_id);

                // console.log(attendance_collection);

                if (attendance_type == "Absen masuk") {
                  await attendance_collection.update({
                    is_verified_arrival: true,
                    photo_url_arrival: publicUrl,
                  });

                  reminder_type = "in";
                } else if (attendance_type == "Absen keluar") {
                  await attendance_collection.update({
                    is_verified_departure: true,
                    photo_url_departure: publicUrl,
                  });

                  const attendance_snapshot = await attendance_collection.get();
                  const attendance_data = attendance_snapshot.data();

                  if (attendance_data.is_checked_overtime != null) {
                    const company_id = await user_company_id[chat_id];

                    await db
                      .collection(`overtime_employees - ${company_id}`)
                      .doc(attendance_snapshot.id)
                      .set({
                        ...attendance_data,
                      });
                  }

                  reminder_type = "out";
                } else {
                  ctx.deleteMessage(message_id);
                  ctx.reply("Tidak ditemukan data lokasi.");

                  return;
                }

                ctx.deleteMessage(message_id);
                ctx.reply(`${attendance_type} berhasil diverifikasi.`);
                ctx.react("👍");

                const reminder_collection = db
                  .collection("reminders")
                  .where("chat_id", "==", chat_id)
                  .limit(1);

                const reminder_snapshot = await reminder_collection.get();

                if (reminder_type == "in") {
                  await reminder_snapshot.docs[0].ref.update({
                    in_is_sent: true,
                  });
                } else if (reminder_type == "out") {
                  await reminder_snapshot.docs[0].ref.update({
                    out_is_sent: true,
                  });
                }
              } else {
                ctx.deleteMessage(message_id);

                ctx.reply(
                  "Terjadi kesalahan saat menerima foto. Cobalah beberapa saat lagi."
                );
              }
            });
          }
        );
      }
    });
  } catch (error) {
    console.log("Error processing photo from user : ", error);

    ctx.deleteMessage(message_id);

    ctx.reply(
      "Terjadi kesalahan saat menerima foto. Cobalah beberapa saat lagi."
    );
  }
});

let user_location = {};
let user_attendance_type = {};
let asking_location_message_id = {};

bot.on(message("location"), async (ctx) => {
  const chat_id = ctx.from.id;

  try {
    let timestamp;
    if (await user_timestamp[chat_id]) {
      timestamp = await user_timestamp[chat_id];
    } else {
      const employee_collection = db.collection("employees");
      const employee_snapshot = await employee_collection
        .where("chat_id", "==", chat_id)
        .limit(1)
        .get();

      if (employee_snapshot.empty) {
        ctx.reply("Profil tidak ditemukan. Silakan kirim kode OTP Anda.", {
          reply_markup: {
            remove_keyboard: true,
          },
        });

        await requestOTP(employee_collection, chat_id);

        return;
      }

      // const employee_doc = employee_snapshot.docs[0].data();
      // const company_id = employee_doc.company_id;

      // const now = DateTime.now().setZone("Asia/Jakarta");
      // const today = now.toFormat("yyyyMMdd");

      // const attendance_doc_ref = db
      //   .collection(`attendances - ${company_id}`)
      //   .doc(`${chat_id} - ${today}`);

      const collection_name = await user_attendance_collection[chat_id]
        .collection_name;

      const document_id = await user_attendance_collection[chat_id].document_id;

      const attendance_collection = db
        .collection(collection_name)
        .doc(document_id);

      // console.log(attendance_collection);

      const attendance_snapshot = await attendance_collection.get();

      if (!attendance_snapshot.exists) {
        ctx.reply("Anda belum melakukan absensi hari ini.", {
          reply_markup: {
            remove_keyboard: true,
          },
        });

        return;
      }

      const attendance_data = attendance_snapshot.data();
      const arrival_time = attendance_data.arrival_time;
      const departure_time = attendance_data.departure_time;

      if (!departure_time) {
        timestamp = arrival_time.toMillis();
        user_attendance_type[chat_id] = "Absen masuk";
      } else {
        timestamp = departure_time.toMillis();
        user_attendance_type[chat_id] = "Absen keluar";
      }
    }

    // const time_limit = timestamp + 30 * 1000;
    // const time_limit = timestamp + 10 * 60 * 1000;
    // const current_time = new Date().valueOf();

    // if (current_time > time_limit) {
    //   ctx.reply(
    //     "Batas waktu verifikasi absen telah habis. Silakan mengulangi proses absen.",
    //     {
    //       reply_markup: {
    //         remove_keyboard: true,
    //       },
    //     }
    //   );

    //   return;
    // }

    const { latitude, longitude } = ctx.message.location;
    user_location[chat_id] = { latitude, longitude };

    const google_maps_link = `https://www.google.com/maps?q=${latitude},${longitude}`;

    await ctx.reply(`Berikut ini lokasi Anda:\n${google_maps_link}`, {
      reply_markup: {
        remove_keyboard: true,
      },
    });

    const { message_id } = await ctx.reply("Apakah lokasi sudah benar?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Ya", callback_data: "yes-location" }],
          [{ text: "Tidak", callback_data: "no-location" }],
        ],
      },
    });

    asking_location_message_id[chat_id] = message_id;
  } catch (error) {
    console.log("Error processing location from user : ", error);
    ctx.reply(
      "Terjadi kesalahan saat menerima lokasi. Cobalah beberapa saat lagi."
    );
  }
});

exports.bot = functions.https.onRequest((req, res) => {
  bot.handleUpdate(req.body, res);
});

exports.checkOverdueShift = functions.pubsub
  .schedule("1 0 * * 1-6") // run every Monday to Saturday at 00:01
  // .schedule("*/5 * * * *") // run every 5 minutes for testing purpose
  .timeZone("Asia/Jakarta")
  .onRun(async (context) => {
    try {
      console.log("Running check overdue shift function.");

      const now = DateTime.now().setZone("Asia/Jakarta");
      // const today = now.toFormat("dd-MM-yyyy");
      const today = now.startOf("day");

      const schedule_shift_snapshot = await db
        .collection("schedule_shift")
        .get();

      schedule_shift_snapshot.forEach(async (doc) => {
        const schedule_shift_data = doc.data();
        const name = schedule_shift_data.name;
        const employee_id = schedule_shift_data.employee_id;
        const company_id = schedule_shift_data.company_id;
        const company_name = schedule_shift_data.company_name;

        const history_shift = {};
        const schedule_shift = { ...schedule_shift_data };

        Object.keys(schedule_shift_data).forEach((key) => {
          // checking format (DD-MM-YYYY)
          const is_date = /^\d{2}-\d{2}-\d{4}$/.test(key);

          console.log(is_date);
          console.log(key);
          console.log(today);

          // if (is_date && key < today) {
          if (is_date) {
            const shift_date = DateTime.fromFormat(key, "dd-MM-yyyy").startOf(
              "day"
            );

            console.log(shift_date);

            if (shift_date < today) {
              // insert overdue shift to history_shift array
              history_shift[key] = schedule_shift[key];

              // delete overdue shift from schedule_shift array
              delete schedule_shift[key];
            }
          }
        });

        if (Object.keys(history_shift).length > 0) {
          // replace schedule_shift with filtered shift
          await db
            .collection("schedule_shift")
            .doc(doc.id)
            .set({
              ...schedule_shift,
            });

          const history_shift_snapshot = await db
            .collection("history_shift")
            .where("employee_id", "==", employee_id)
            .limit(1)
            .get();

          if (!history_shift_snapshot.empty) {
            const employee_doc = history_shift_snapshot.docs[0];
            const employee_doc_ref = db
              .collection("history_shift")
              .doc(employee_doc.id);

            // insert overdue shift to history_shift
            await employee_doc_ref.set(
              {
                ...history_shift,
              },
              { merge: true }
            );
          } else {
            // add overdue shift to history_shift
            await db.collection("history_shift").add({
              name: name,
              employee_id: employee_id,
              company_id: company_id,
              company_name: company_name,
              ...history_shift,
            });
          }
        }
      });
    } catch (error) {
      console.log("Error checking overdue shift : ", error);
    }
  });

exports.updateSalary = functions.pubsub
  .schedule("0 3 * * *") // run every day at 03:00
  // .schedule("*/5 * * * *") // run every 5 minutes for testing purpose
  .timeZone("Asia/Jakarta")
  .onRun(async (context) => {
    const employee_snapshot = await db.collection("employees").get();

    employee_snapshot.forEach(async (doc) => {
      const employee_data = doc.data();
      const employee_id = doc.id;
      const company_id = employee_data.company_id;
      const division = employee_data.divisi;
      const expected_salary = employee_data.gaji_pokok;

      console.log(company_id);
      console.log(division);

      const division_snapshot = await db
        .collection("divisions")
        .where("company_id", "==", company_id)
        .where("name_division", "==", division)
        .limit(1)
        .get();

      if (!division_snapshot.empty) {
        const division_data = division_snapshot.docs[0].data();
        const work_hours_per_week = division_data.jam_kerja_mingguan;
        const expected_work_hours = work_hours_per_week * 4;

        const salary_per_hour = expected_salary / expected_work_hours;

        const now = DateTime.now().setZone("Asia/Jakarta");
        const month = now.setLocale("id").toFormat("MMMM");
        const year = now.year;

        const attendance_snapshot = await db
          .collection(`attendances - ${company_id}`)
          .where("employee_id", "==", employee_id)
          .where("month", "==", month)
          .where("year", "==", year)
          .get();

        if (!attendance_snapshot.empty) {
          let total_minutes_worked = 0;

          attendance_snapshot.forEach((attendance_doc) => {
            const attendance_data = attendance_doc.data();
            if (!"out_status" in attendance_data) {
              const work_hours = attendance_data.work_hours;
              const expected_hours = attendance_data.expected_hours;

              console.log(work_hours);

              if (work_hours) {
                const hours_match = work_hours.match(/(\d+)\s*jam/);
                const minutes_match = work_hours.match(/(\d+)\s*menit/);

                const hours = hours_match ? parseInt(hours_match[1]) : 0;
                const minutes = minutes_match ? parseInt(minutes_match[1]) : 0;

                console.log(hours);
                console.log(minutes);

                if (hours >= expected_hours) {
                  total_minutes_worked += hours * 60;
                } else {
                  total_minutes_worked += hours * 60 + minutes;
                }
              }
            }
          });

          console.log(total_minutes_worked);

          const total_hours_worked = Math.ceil(total_minutes_worked / 60);
          console.log(total_hours_worked);

          let salary = Math.ceil(total_hours_worked * salary_per_hour);

          if (salary >= expected_salary) {
            salary = expected_salary;
          }

          console.log(salary);

          const salary_snapshot = await db
            .collection(`salaries - ${company_id}`)
            .where("employee_id", "==", employee_id)
            .where("month", "==", month)
            .where("year", "==", year)
            .limit(1)
            .get();

          if (!salary_snapshot.empty) {
            const salary_doc = salary_snapshot.docs[0];
            const salary_doc_ref = db
              .collection(`salaries - ${company_id}`)
              .doc(salary_doc.id);

            await salary_doc_ref.update({
              salary: salary,
            });
          } else {
            const employee_name = employee_data.name;
            const company_name = employee_data.company_name;
            const position = employee_data.jabatan;

            await db.collection(`salaries - ${company_id}`).add({
              employee_id: employee_id,
              employee_name: employee_name,
              company_id: company_id,
              company_name: company_name,
              division: division,
              position: position,
              expected_work_hours: expected_work_hours,
              total_hours_worked: total_hours_worked,
              expected_salary: expected_salary,
              salary: salary,
              month: month,
              year: year,
              is_paid: false,
              payment_receipt: null,
            });
          }
        }
      }
    });
  });

exports.checkOutAttendance = functions.pubsub
  .schedule("* * * * *") // run every day at 03:00
  // .schedule("*/5 * * * *") // run every 5 minutes for testing purpose
  .timeZone("Asia/Jakarta")
  .onRun(async (context) => {
    const employee_snapshot = await db.collection("employees").get();

    employee_snapshot.forEach(async (doc) => {
      const employee_data = doc.data();
      const employee_id = doc.id;
      const company_id = employee_data.company_id;
      const chat_id = employee_data.chat_id;

      const now = DateTime.now().setZone("Asia/Jakarta");
      const month = now.setLocale("id").toFormat("MMMM");
      const date = now.setLocale("id").toFormat("yyyyMMdd");

      const attendance_collection = db
        .collection(`attendances - ${company_id}`)
        .doc(`${chat_id} - ${date}`);

      const attendance_snapshot = await attendance_collection.get();
      // .where("month", "==", month)
      // .where("employee_id", "==", employee_id)

      if (attendance_snapshot.exists) {
        // attendance_snapshot.forEach(async (attendance_doc) => {
        const attendance_data = attendance_snapshot.data();
        // console.log(attendance_data);

        if (!attendance_data.hasOwnProperty("photo_url_departure")) {
          const sent_count = attendance_data.sent_count;
          const reminder_1 = attendance_data.clock_out_reminder_1;
          const reminder_2 = attendance_data.clock_out_reminder_2;
          const reminder_3 = attendance_data.clock_out_reminder_3;
          const reminder_4 = attendance_data.clock_out_reminder_4;

          console.log(reminder_1);
          console.log(reminder_2);
          console.log(reminder_3);
          console.log(reminder_4);

          const [hours_1, minutes_1] = reminder_1.split(":").map(Number);
          const [hours_2, minutes_2] = reminder_2.split(":").map(Number);
          const [hours_3, minutes_3] = reminder_3.split(":").map(Number);
          const [hours_4, minutes_4] = reminder_4.split(":").map(Number);

          const telegram_api_url = `https://api.telegram.org/bot${
            functions.config().telegrambot.key
          }/sendMessage`;

          if (
            now.hour === hours_1 &&
            now.minute === minutes_1 &&
            sent_count === 0
          ) {
            await axios.post(telegram_api_url, {
              chat_id: chat_id,
              text: `⚠️ Jangan lupa untuk absen keluar! Segera lakukan absen keluar melalui command /keluar`,
            });

            await attendance_collection.update({
              sent_count: 1,
            });
          }

          if (
            now.hour === hours_2 &&
            now.minute === minutes_2 &&
            sent_count === 1
          ) {
            await axios.post(telegram_api_url, {
              chat_id: chat_id,
              text: `⚠️ Anda belum melakukan absen keluar. Segera lakukan absen keluar melalui command /keluar sebelum batas waktu terlewati.`,
            });

            await attendance_collection.update({
              sent_count: 2,
            });
          }

          if (
            now.hour === hours_3 &&
            now.minute === minutes_3 &&
            sent_count === 2
          ) {
            await axios.post(telegram_api_url, {
              chat_id: chat_id,
              text: `⚠️ Peringatan Terakhir : Jika Anda tidak melakukan absen keluar dalam 15 menit, sistem akan mencatat bahwa Anda tidak melakukan absen keluar.\n\nSegera lakukan absen keluar melalui command /keluar`,
            });

            await attendance_collection.update({
              sent_count: 3,
            });
          }

          if (
            now.hour === hours_4 &&
            now.minute === minutes_4 &&
            sent_count === 3
          ) {
            // let status = attendance_data.out_status;
            // const expected_hours = attendance_data.expected_hours;

            // let work_hours;
            // if (clock_out != null) {
            //   const arrival_time = attendance_data.arrival_time.toDate();
            //   work_hours = DateTime.fromJSDate(arrival_time, {
            //     zone: "Asia/Jakarta",
            //   }).plus({ hours: expected_hours });
            // } else {
            //   work_hours = expected_hours;
            // }

            // if (status == null) {
            status = "Tidak Absen Keluar";
            // }

            await db
              .collection(`attendances - ${company_id}`)
              .doc(attendance_snapshot.id)
              .update({
                departure_time: null,
                employee_departure_location: null,
                photo_url_departure: null,
                is_verified_departure: false,
                overtime: false,
                is_checked_overtime: null,
                // work_hours: `${expected_hours} jam`,
                work_hours: "0 jam",
                out_status: "Tidak Absen Keluar",
                is_verified_out_status: null,
              });
          }
        }
        // });
      }
    });
  });

exports.checkExpiredToken = functions.pubsub
  .schedule("* * * * *") // run every minute
  // .schedule("*/5 * * * *") // run every 5 minutes for testing purpose
  .timeZone("Asia/Jakarta")
  .onRun(async (context) => {
    const token_snapshot = await db.collection("tokens").get();

    if (!token_snapshot.empty) {
      let count = 0;
      for (const doc of token_snapshot.docs) {
        const token_data = doc.data();
        const expiration = token_data.expiration;

        if (Date.now() > expiration) {
          console.log("Token kedaluwarsa");

          if (token_data.hasOwnProperty("document_id")) {
            const company_id = token_data.company_id;
            const document_id = token_data.document_id;

            await db
              .collection(`leave - ${company_id}`)
              .doc(document_id)
              .delete();
          }

          await doc.ref.delete();
          count++;
        } else {
          console.log("Token masih berlaku");
        }
      }

      console.log(`${count} token(s) deleted`);
    }
  });

// exports.moveToAttendance = functions.firestore
//   .document("{collectionId}/{docId}")
//   .onUpdate(async (change, context) => {});

// exports.runReminder = functions.pubsub
//   .schedule("*/1 * * * *") // run every 1 minute for testing purpose
//   .timeZone("Asia/Jakarta")
//   .onRun(async (context) => {
//     const now = DateTime.now().setZone("Asia/Jakarta");
//     const time = now.toFormat("HH:mm");
// });
