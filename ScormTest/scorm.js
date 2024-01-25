/* global pipwerks */

(function() {
    'use strict';
    var startTimeStamp, scormUnload, actions, student;

    //create old string format to save in LMS for Gecko Checkpoint ticking
    function oldStringFormat(data) {
        var dataArray = data.split(',');
        var newString = '';
        var indexString = '';
        for (var i = 0; i < dataArray.length; i++) {
            indexString = String('000' + i).slice(-3);
            newString += indexString + ',' + dataArray[i] + ',';
        }
        newString = newString.substring(0, newString.length - 1);
        return newString;
    }

    // Left-pads intNum to intNumDigits, using zeroes.
    function zeroPad(intNum, intNumDigits) {
        var strTemp, intLen, i;

        strTemp = '' + intNum;
        intLen = strTemp.length;

        if (intLen > intNumDigits) {
            return strTemp.substr(0, intNumDigits);
        } else {
            for (i = intLen; i < intNumDigits; i++) {
                strTemp = '0' + strTemp;
            }
        }

        return strTemp;
    }

    // SCORM requires time to be formatted in a specific way (ew). This
    // function bludgeons a sensible time-in-milliseconds into SCORM's format.
    // The second parameter indicates whether fractional components of the time
    // are to be included in the result.
    function convertMilliSecondsToSCORMTime(intTotalMilliseconds, blnIncludeFraction) {
        var intHours, intMinutes, intSeconds, intMilliseconds, intHundredths, strCMITimeSpan;

        // By default, blnIncludeFraction is true.
        if (blnIncludeFraction === null) blnIncludeFraction = true;

        //extract time parts
        intMilliseconds = intTotalMilliseconds % 1000;
        intSeconds = ((intTotalMilliseconds - intMilliseconds) / 1000) % 60;
        intMinutes = ((intTotalMilliseconds - intMilliseconds - (intSeconds * 1000)) / 60000) % 60;
        intHours = (intTotalMilliseconds - intMilliseconds - (intSeconds * 1000) - (intMinutes * 60000)) / 3600000;

        /*
         deal with exceptional case when content used a huge amount of time and interpreted CMITimstamp
         to allow a number of intMinutes and seconds greater than 60 i.e. 9999:99:99.99 instead of 9999:60:60:99
         note - this case is permissable under SCORM, but will be exceptionally rare
         */

        if (intHours === 10000) intHours = 9999;

        intMinutes = (intTotalMilliseconds - (intHours * 3600000)) / 60000;
        if (intMinutes === 100) intMinutes = 99;
        intMinutes = Math.floor(intMinutes);

        intSeconds = (intTotalMilliseconds - (intHours * 3600000) - (intMinutes * 60000)) / 1000;
        if (intSeconds === 100) intSeconds = 99;
        intSeconds = Math[blnIncludeFraction ? 'floor' : 'round'](intSeconds);

        intMilliseconds = (intTotalMilliseconds - (intHours * 3600000) - (intMinutes * 60000) - (intSeconds * 1000));

        //drop the extra precision from the milliseconds
        intHundredths = Math.round(intMilliseconds / 10);
        if (intHundredths >= 100) {
            intSeconds++;
            intHundredths %= 100;
        }

        //put in padding 0's and concatinate to get the proper format
        strCMITimeSpan = zeroPad(intHours, 4) + ':' + zeroPad(intMinutes, 2) + ':' + zeroPad(intSeconds, 2);

        if (blnIncludeFraction) strCMITimeSpan += '.' + intHundredths;

        //check for case where total milliseconds is greater than max supported by strCMITimeSpan
        if (intHours > 9999) {
            strCMITimeSpan = '9999:99:99';

            if (blnIncludeFraction) strCMITimeSpan += '.99';
        }

        return strCMITimeSpan;
    }

    // Track session time by recording the time now during initialisation, and
    // again when the window is closed.
    startTimeStamp = new Date();
    scormUnload = function() {
        var endTimeStamp, totalMilliseconds, scormTime, lessonStatus;
        //record the session time (if incomplete)
        lessonStatus = pipwerks.SCORM.get('cmi.core.lesson_status');
        if (lessonStatus === 'incomplete') {
            endTimeStamp = new Date();
            totalMilliseconds = (endTimeStamp.getTime() - startTimeStamp.getTime());
            scormTime = convertMilliSecondsToSCORMTime(totalMilliseconds, false);
            pipwerks.SCORM.set('cmi.core.session_time', scormTime);
            pipwerks.SCORM.save();
        }
        pipwerks.SCORM.quit();

        // replace self with empty function to avoid being called more than once
        scormUnload = function() {
        };
    };

    window.onunload = function() {
        scormUnload();
    };
    window.onbeforeunload = window.onunload;

    // Possible actions sent from the eCoach app, so that progress can be saved
    // to SCORM.
    actions = {
        giveMeProgress: function(msg, e) {
            var suspendData;
            suspendData = pipwerks.SCORM.get('cmi.suspend_data');
            e.source.postMessage(suspendData, e.origin);
        },
        sendingticks: function(msg) {
            if (msg.data && msg.data !== 'noSession') {
                pipwerks.SCORM.set('cmi.suspend_data', oldStringFormat(msg.data));
                pipwerks.SCORM.save();
            }
        },
        sendingtickscheck: function(msg) {
            var scorePercent, currentScore;
            if (msg.data && msg.data !== 'noSession') {
                pipwerks.SCORM.set('cmi.suspend_data', oldStringFormat(msg.data));
                pipwerks.SCORM.save();
                scorePercent = parseInt(msg.check, 10);
                currentScore = Number(pipwerks.SCORM.get('cmi.core.score.raw'));
                if (scorePercent > currentScore) {
                    pipwerks.SCORM.set('cmi.core.score.min', '0');
                    pipwerks.SCORM.save();
                    pipwerks.SCORM.set('cmi.core.score.max', '100');
                    pipwerks.SCORM.save();
                    pipwerks.SCORM.set('cmi.core.score.raw', '' + scorePercent);
                    pipwerks.SCORM.save();
                }
            }
        },
        unitComplete: function(msg) {
            var lessonStatus, completeSuccess;
            var version = pipwerks.SCORM.version;
            lessonStatus = pipwerks.SCORM.get(version === '2004' ? 'cmi.completion_status' : 'cmi.core.lesson_status');
            if (lessonStatus === 'completed' || lessonStatus === 'passed') return;
            pipwerks.SCORM.set('cmi.suspend_data', oldStringFormat(msg.data));
            pipwerks.SCORM.save();
            pipwerks.SCORM.set('cmi.core.score.min', '0');
            pipwerks.SCORM.save();
            pipwerks.SCORM.set('cmi.core.score.max', '100');
            pipwerks.SCORM.save();
            pipwerks.SCORM.set('cmi.core.score.raw', '100');
            pipwerks.SCORM.save();

            completeSuccess = pipwerks.SCORM.set(version === '2004' ? 'cmi.completion_status' : 'cmi.core.lesson_status', 'completed');
            pipwerks.SCORM.save();

            if (completeSuccess) return;
            // Connection may have been lost - try to connect again.
            pipwerks.SCORM.init();
            actions.unitComplete(msg);
        },
        getInfo: function(msg, e) {
            var info = {};
            var version = pipwerks.SCORM.version;
            info['entry'] = pipwerks.SCORM.get(version === '2004' ? 'cmi.entry' : 'cmi.core.entry');
            info['lesson_mode'] = pipwerks.SCORM.get('cmi.core.lesson_mode');
            info['suspend_data'] = pipwerks.SCORM.get('cmi.suspend_data');
            info['completion_status'] = pipwerks.SCORM.get(version === '2004' ? 'cmi.completion_status' : 'cmi.core.lesson_status');
            info['total_time'] = pipwerks.SCORM.get('cmi.core.total_time');
            info['max_time_allowed'] = pipwerks.SCORM.get('cmi.core.max_time_allowed');
            e.source.postMessage(info, e.origin);
        },
        startQuiz: function(msg) {
            if (pipwerks.SCORM.get('cmi.core.lesson_status') !== 'incomplete') return;
            // Actually start the quiz - in case loading took up some of the quiz time.
            startTimeStamp = new Date(msg.timestamp);
            console.log('Starting quiz timer at ' + startTimeStamp);
        },
        quizQuestionComplete: function(msg) {
            if (msg.data && msg.data !== 'noSession') {
                pipwerks.SCORM.set('cmi.suspend_data', oldStringFormat(msg.data));
                pipwerks.SCORM.save();
            }
        },
        quizComplete: function(msg) {
            var lessonStatus, completeSuccess, endTimeStamp, totalMilliseconds, scormTime;
            lessonStatus = pipwerks.SCORM.get('cmi.core.lesson_status');
            if (lessonStatus === 'completed' || lessonStatus === 'passed') return;

            pipwerks.SCORM.set('cmi.suspend_data', oldStringFormat(msg.data));
            pipwerks.SCORM.save();

            // Use percentage, because Moodle sets the max score to 100 regardless :(
            var scorePercent = parseInt(msg.score.percent, 10);
            var currentScore = Number(pipwerks.SCORM.get('cmi.core.score.raw'));

            if (scorePercent > currentScore) {
                pipwerks.SCORM.set('cmi.core.score.min', '0');
                pipwerks.SCORM.save();
                pipwerks.SCORM.set('cmi.core.score.max', '100');
                pipwerks.SCORM.save();
                pipwerks.SCORM.set('cmi.core.score.raw', '' + scorePercent);
                pipwerks.SCORM.save();
            }

            var masteryScore = pipwerks.SCORM.get('cmi.student_data.mastery_score');
            if (scorePercent >= masteryScore) {
                completeSuccess = pipwerks.SCORM.set('cmi.core.lesson_status', 'passed');
            } else {
                completeSuccess = pipwerks.SCORM.set('cmi.core.lesson_status', 'failed');
            }
            pipwerks.SCORM.save();

            //record the session time
            endTimeStamp = new Date(msg.timestamp);
            totalMilliseconds = (endTimeStamp.getTime() - startTimeStamp.getTime());
            scormTime = convertMilliSecondsToSCORMTime(totalMilliseconds, false);
            console.log('Completed Quiz at ' + endTimeStamp);
            pipwerks.SCORM.set('cmi.core.session_time', scormTime);
            pipwerks.SCORM.save();

            if (completeSuccess) {
                return;
            }

            // Connection may have been lost - try to connect again.
            pipwerks.SCORM.init();
            actions.quizComplete(msg);
        }
    };

    // Dispatch messages received from the Coassemble application to actions here
    // on the Moodle side.
    function listener(event) {
        var message;
        try {
            message = JSON.parse(event.data);
        } catch {
            // Event data is maybe already JSON
            // More likely to be a stray message that isn't from Coassemble
        }
        if (message && message.action && message.action in actions) return actions[message.action](message, event);
    }

    // Register the onmessage listener in a cross-browser way -
    // addEventListener() works on decent browsers, attachEvent() elsewhere.
    if (window.addEventListener) {
        window.addEventListener('message', listener, false);
    } else {
        window.attachEvent('onmessage', listener);
    }

    if (pipwerks.SCORM.init()) {

        student = {
            id: pipwerks.SCORM.get('cmi.core.student_id'),
            name: pipwerks.SCORM.get('cmi.core.student_name')
        };

        // Insert the student information into the form and submit it - we use a
        // form instead of an AJAX post request because forms can more easily work
        // cross-domain, especially in older non-CORS-working browsers.
        document.getElementById('studentId').value = student.id;
        document.getElementById('studentName').value = student.name;
        document.getElementById('ourForm').submit();
    }
})();
