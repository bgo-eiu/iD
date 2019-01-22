import _throttle from 'lodash-es/throttle';
import { select as d3_select } from 'd3-selection';

import { modeBrowse } from '../modes';
import { svgPointTransform } from './index';
import { services } from '../services';

var _improveOsmEnabled = false;
var _errorService;


export function svgImproveOSM(projection, context, dispatch) {
    var throttledRedraw = _throttle(function () { dispatch.call('change'); }, 1000);
    var minZoom = 12;
    var touchLayer = d3_select(null);
    var drawLayer = d3_select(null);
    var _improveOsmVisible = false;


    // TODO this is just reusing the path from the svg, probably some way to make that automatic (and therefore general)
    function markerPath(selection, klass) {
        selection
            .attr('class', klass)
            .attr('transform', 'translate(-9, -20)')
            .attr('d', 'M15,6.5h-4.2l1.3-4.7c0.1-0.5-0.4-1-0.9-1H6.2C5.8,0.7,5.4,1,5.4,1.5l-1.2,8.7c-0.1,0.6,0.4,1,0.8,1h4.3l-1.7,7.1c-0.1,0.5,0.4,1,0.9,1c0.3,0,0.6-0.2,0.7-0.5l6.4-11C16,7.2,15.6,6.5,15,6.5z');
    }


    // Loosely-coupled improveOSM service for fetching errors.
    function getService() {
        if (services.improveOSM && !_errorService) {
            _errorService = services.improveOSM;
            _errorService.on('loaded', throttledRedraw);
        } else if (!services.improveOSM && _errorService) {
            _errorService = null;
        }

        return _errorService;
    }


    // Show the errors
    function editOn() {
        if (!_improveOsmVisible) {
            _improveOsmVisible = true;
            drawLayer
                .style('display', 'block');
        }
    }


    // Immediately remove the errors and their touch targets
    function editOff() {
        if (_improveOsmVisible) {
            _improveOsmVisible = false;
            drawLayer
                .style('display', 'none');
            drawLayer.selectAll('.qa_error.iOSM')
                .remove();
            touchLayer.selectAll('.qa_error.iOSM')
                .remove();
        }
    }


    // Enable the layer.  This shows the errors and transitions them to visible.
    function layerOn() {
        editOn();

        drawLayer
            .style('opacity', 0)
            .transition()
            .duration(250)
            .style('opacity', 1)
            .on('end interrupt', function () {
                dispatch.call('change');
            });
    }


    // Disable the layer.  This transitions the layer invisible and then hides the errors.
    function layerOff() {
        throttledRedraw.cancel();
        drawLayer.interrupt();
        touchLayer.selectAll('.qa_error.iOSM')
            .remove();

        drawLayer
            .transition()
            .duration(250)
            .style('opacity', 0)
            .on('end interrupt', function () {
                editOff();
                dispatch.call('change');
            });
    }


    // Update the error markers
    function updateMarkers() {
        if (!_improveOsmVisible || !_improveOsmEnabled) return;

        var service = getService();
        var selectedID = context.selectedErrorID();
        var data = (service ? service.getErrors(projection) : []);
        var getTransform = svgPointTransform(projection);

        // Draw markers..
        var markers = drawLayer.selectAll('.qa_error.iOSM')
            .data(data, function(d) { return d.id; });

        // exit
        markers.exit()
            .remove();

        // enter
        var markersEnter = markers.enter()
            .append('g')
            .attr('class', function(d) {
                return [
                    'qa_error',
                    d.source,
                    'error_id-' + d.id,
                    'error_type-' + d.error_type + '-' + d.error_subtype
                ].join(' ');
            });

        markersEnter
            .append('ellipse')
            .attr('cx', 0)
            .attr('cy', 0)
            .attr('rx', 5)
            .attr('ry', 2)
            .attr('class', 'stroke');

        markersEnter
            .append('path')
            .call(markerPath, 'shadow');

        markersEnter
            .append('use')
            .attr('class', 'qa_error-fill')
            .attr('width', '20px')
            .attr('height', '20px')
            .attr('x', '-9px') // point of bolt is not perfectly centered
            .attr('y', '-20px')
            .attr('xlink:href', '#iD-icon-bolt');

        // update
        markers
            .merge(markersEnter)
            .sort(sortY)
            .classed('selected', function(d) { return d.id === selectedID; })
            .attr('transform', getTransform);


        // Draw targets..
        if (touchLayer.empty()) return;
        var fillClass = context.getDebug('target') ? 'pink ' : 'nocolor ';

        var targets = touchLayer.selectAll('.qa_error.iOSM')
            .data(data, function(d) { return d.id; });

        // exit
        targets.exit()
            .remove();

        // enter/update
        targets.enter()
            .append('rect')
            .attr('width', '20px')
            .attr('height', '20px')
            .attr('x', '-9px')
            .attr('y', '-20px')
            .merge(targets)
            .sort(sortY)
            .attr('class', function(d) {
                return 'qa_error ' + d.source + ' target error_id-' + d.id + ' ' + fillClass;
            })
            .attr('transform', getTransform);


        function sortY(a, b) {
            return (a.id === selectedID) ? 1
                : (b.id === selectedID) ? -1
                : (a.severity === 'error' && b.severity !== 'error') ? 1
                : (b.severity === 'error' && a.severity !== 'error') ? -1
                : b.loc[1] - a.loc[1];
        }
    }


    // Draw the ImproveOSM layer and schedule loading errors and updating markers.
    function drawImproveOSM(selection) {
        var service = getService();

        var surface = context.surface();
        if (surface && !surface.empty()) {
            touchLayer = surface.selectAll('.data-layer.touch .layer-touch.markers');
        }

        drawLayer = selection.selectAll('.layer-improveOSM')
            .data(service ? [0] : []);

        drawLayer.exit()
            .remove();

        drawLayer = drawLayer.enter()
            .append('g')
            .attr('class', 'layer-improveOSM')
            .style('display', _improveOsmEnabled ? 'block' : 'none')
            .merge(drawLayer);

        if (_improveOsmEnabled) {
            if (service && ~~context.map().zoom() >= minZoom) {
                editOn();
                service.loadErrors(projection);
                updateMarkers();
            } else {
                editOff();
            }
        }
    }


    // Toggles the layer on and off
    drawImproveOSM.enabled = function(val) {
        if (!arguments.length) return _improveOsmEnabled;

        _improveOsmEnabled = val;
        if (_improveOsmEnabled) {
            layerOn();
        } else {
            layerOff();
            if (context.selectedErrorID()) {
                context.enter(modeBrowse(context));
            }
        }

        dispatch.call('change');
        return this;
    };


    drawImproveOSM.supported = function() {
        return !!getService();
    };


    return drawImproveOSM;
}
